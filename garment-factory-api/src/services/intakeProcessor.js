const pool = require('../db');
const { parseOrderMessage } = require('./orderParser');
const { createOrder } = require('./orders');
const { createPendingReview, findPendingByThreadId, findPendingBySenderEmail } = require('./pendingReview');
const { sendEmail } = require('./gmailSender');
const { triggerFollowUp } = require('./followUpNotifier');

function getFieldByPath(obj, path) {
  const parts = path.replace(/\[/g, '.').replace(/\]/g, '').split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function deepMerge(base, updates) {
  if (Array.isArray(base) && Array.isArray(updates)) {
    const length = Math.max(base.length, updates.length);
    const merged = [];

    for (let index = 0; index < length; index += 1) {
      if (updates[index] === undefined) {
        merged.push(base[index]);
      } else if (base[index] === undefined) {
        merged.push(updates[index]);
      } else {
        merged.push(deepMerge(base[index], updates[index]));
      }
    }

    return merged;
  }

  if (
    base &&
    updates &&
    typeof base === 'object' &&
    typeof updates === 'object' &&
    !Array.isArray(base) &&
    !Array.isArray(updates)
  ) {
    const merged = { ...base };

    for (const [key, value] of Object.entries(updates)) {
      merged[key] = key in merged ? deepMerge(merged[key], value) : value;
    }

    return merged;
  }

  return updates;
}

async function getUnknownGarmentTypes(items, factoryId) {
  if (!items || items.length === 0) return [];
  const uniqueTypes = [...new Set(items.map(i => i.garment_type).filter(Boolean))];
  const unknown = [];
  for (const type of uniqueTypes) {
    const result = await pool.query(
      `SELECT COUNT(*) as cnt FROM bom WHERE LOWER(garment_type) = LOWER($1) AND factory_id = $2`,
      [type, factoryId]
    );
    if (Number(result.rows[0].cnt) === 0) {
      unknown.push(type);
    }
  }
  return unknown;
}

async function getAvailableGarmentTypes(factoryId) {
  const result = await pool.query(
    `SELECT DISTINCT garment_type FROM bom WHERE factory_id = $1 ORDER BY garment_type`,
    [factoryId]
  );
  return result.rows.map(r => r.garment_type);
}

async function sendUnknownTypeReply({ factoryId, buyerEmail, buyerName, unknownTypes, availableTypes, threadId }) {
  try {
    const factoryRes = await pool.query('SELECT name FROM factories WHERE id = $1', [factoryId]);
    const factoryName = factoryRes.rowCount > 0 ? factoryRes.rows[0].name : 'Our factory';

    const subject = 'Regarding your order';
    const body = [
      `Hi ${buyerName || 'there'},`,
      '',
      `Thanks for your order. Unfortunately, we don't manufacture the following items:`,
      ...unknownTypes.map(t => `  \u2022 ${t}`),
      '',
      `We currently manufacture: ${availableTypes.join(', ')}.`,
      '',
      `Would you like to modify your order to use the types we offer? Just reply to this email.`,
      '',
      'Thanks,',
      factoryName,
    ].join('\n');

    await sendEmail({ factoryId, to: buyerEmail, subject, body, threadId });
    console.log(`[INTAKE] Auto-reply sent to ${buyerEmail} about unknown types: ${unknownTypes.join(', ')}`);
  } catch (err) {
    console.error('[INTAKE] Failed to send unknown-type auto-reply:', err.message);
  }
}

async function processIncomingMessage({ factory_id, source, sender, raw_message, thread_id }) {
  const parsed = await parseOrderMessage(raw_message);

  // ---- MERGE PATH: check if this message is a follow-up to an existing unreviewed pending_review ----
  let existingReview = null;
  if (thread_id && parsed.error !== 'api_error') {
    existingReview = await findPendingByThreadId(thread_id, factory_id);
  }

  // Fallback: match by order_reference extracted by LLM from the reply body
  // (buyer replied on a different thread but kept the reference in quoted text)
  if (!existingReview && parsed.error !== 'api_error' && parsed.order_reference) {
    const refMatch = parsed.order_reference.match(/MSME-([a-f0-9]+)/i);
    if (refMatch) {
      const refId = refMatch[1];
      const result = await pool.query(
        `SELECT * FROM pending_review WHERE id LIKE $1 AND factory_id = $2 AND reviewed = false ORDER BY created_at DESC LIMIT 1`,
        [`%${refId}`, factory_id]
      );
      if (result.rowCount > 0) {
        existingReview = result.rows[0];
        if (existingReview && typeof existingReview.parsed_result === 'string') {
          existingReview.parsed_result = JSON.parse(existingReview.parsed_result);
        }
        if (existingReview && typeof existingReview.missing_fields === 'string') {
          existingReview.missing_fields = JSON.parse(existingReview.missing_fields);
        }
      }
    }
  }

  // Third fallback: if no thread or reference match, check if the same sender
  // has an unreviewed pending_review with followup_sent = true
  if (!existingReview && parsed.error !== 'api_error' && sender) {
    existingReview = await findPendingBySenderEmail(sender, factory_id);
  }

  if (existingReview) {
    // Merge the new parsed data into the existing pending_review
    // Only merge data fields — keep control fields (is_order, confidence, etc.) from original
    const mergeableFields = [
      'buyer_name', 'buyer_contact', 'delivery_deadline',
      'items', 'special_instructions',
    ];
    const mergeData = {};
    for (const field of mergeableFields) {
      if (parsed[field] !== undefined && parsed[field] !== null) {
        if (!Array.isArray(parsed[field]) || parsed[field].length > 0) {
          mergeData[field] = parsed[field];
        }
      }
    }

    const mergedResult = deepMerge(existingReview.parsed_result, mergeData);
    // Restore original control fields that shouldn't be overwritten by fragment parsing
    mergedResult.is_order = true;
    mergedResult.confidence = existingReview.parsed_result.confidence || 'medium';
    delete mergedResult.error;
    delete mergedResult.missing_fields;
    delete mergedResult.needs_followup;
    delete mergedResult.followup_questions;

    // Recalculate missing_fields from merged result using LLM's full criteria
    const storedMissing = [];
    if (!mergedResult.buyer_name) storedMissing.push('buyer_name');
    if (!mergedResult.items || mergedResult.items.length === 0) {
      storedMissing.push('items');
    } else {
      mergedResult.items.forEach((item, i) => {
        if (!item.garment_type) storedMissing.push(`items[${i}].garment_type`);
        if (!item.quantity) storedMissing.push(`items[${i}].quantity`);
        if (!item.fabric_type) storedMissing.push(`items[${i}].fabric_type`);
        if (!item.colour) storedMissing.push(`items[${i}].colour`);
        if (!item.size_breakdown) storedMissing.push(`items[${i}].size_breakdown`);
      });
    }
    if (!mergedResult.delivery_deadline) storedMissing.push('delivery_deadline');

    const storedMissingJson = storedMissing.length > 0 ? JSON.stringify(storedMissing) : null;
    const parsedResultJson = JSON.stringify(mergedResult);

    await pool.query(
      `UPDATE pending_review SET parsed_result = $1, missing_fields = $2, raw_message = $3 WHERE id = $4`,
      [parsedResultJson, storedMissingJson, raw_message, existingReview.id]
    );

    // Check if ALL originally-flagged missing fields are now filled in merged data
    const originalMissing = existingReview.missing_fields || [];
    const allOriginalFilled = originalMissing.length === 0 ||
      originalMissing.every(f => getFieldByPath(mergedResult, f));

    // Check minimum insertOrder requirements
    const hasMinimumData = mergedResult.buyer_name &&
      mergedResult.items && mergedResult.items.length > 0 &&
      mergedResult.items.every(i => i.garment_type && i.quantity);

    if (!allOriginalFilled || !hasMinimumData) {
      return { outcome: 'pending_review_updated', id: existingReview.id };
    }

    // Check if all garment types exist in BOM before creating order
    const unknownTypes = await getUnknownGarmentTypes(mergedResult.items, factory_id);
    if (unknownTypes.length > 0) {
      const availableTypes = await getAvailableGarmentTypes(factory_id);
      await sendUnknownTypeReply({
        factoryId: factory_id,
        buyerEmail: existingReview.sender_id || sender,
        buyerName: mergedResult.buyer_name,
        unknownTypes,
        availableTypes,
        threadId: existingReview.thread_id,
      });
      return { outcome: 'pending_review_updated', unknown_types: unknownTypes };
    }

    // All fields present — auto-create the order with pricing
    try {
      const payload = {
        buyer_name: mergedResult.buyer_name,
        buyer_contact: mergedResult.buyer_contact || existingReview.sender_id || sender,
        delivery_deadline: mergedResult.delivery_deadline,
        notes: mergedResult.special_instructions,
        items: mergedResult.items || [],
        source,
        buyer_email: existingReview.sender_id || sender,
      };
      const order = await createOrder(payload, factory_id);

      await pool.query(
        `UPDATE pending_review SET reviewed = true WHERE id = $1`,
        [existingReview.id]
      );

      return { outcome: 'order_created', id: order.id };
    } catch (err) {
      console.error('[INTAKE] Auto-create order failed after merge.');
      console.error('[INTAKE] Payload:', JSON.stringify(payload, null, 2));
      console.error('[INTAKE] Error:', err.stack || err.message);
      return { outcome: 'pending_review_updated', id: existingReview.id };
    }
  }

  // ---- NO EXISTING REVIEW: original flow unchanged ----

  if (parsed.error === 'api_error') {
    await createPendingReview({
      raw_message,
      source,
      sender_id: sender,
      parsed_result: parsed,
      reason: 'api_error',
      factory_id,
      followup_needed: true,
      thread_id,
    });
    return { outcome: 'pending_review', id: null };
  }

  if (!parsed.is_order) {
    return { outcome: 'ignored', id: null };
  }

  const missingFields = [];
  if (!parsed.buyer_name) missingFields.push('buyer_name');
  if (!parsed.items || parsed.items.length === 0) {
    missingFields.push('items');
  } else {
    parsed.items.forEach((item, i) => {
      if (!item.garment_type) missingFields.push(`items[${i}].garment_type`);
      if (!item.quantity) missingFields.push(`items[${i}].quantity`);
    });
  }

  const lowConfidence = parsed.confidence === 'low';

  if (missingFields.length > 0 || lowConfidence) {
    const review = await createPendingReview({
      raw_message,
      source,
      sender_id: sender,
      parsed_result: parsed,
      reason: 'missing_fields',
      factory_id,
      missing_fields: missingFields.length > 0 ? missingFields : parsed.missing_fields || null,
      followup_needed: true,
      thread_id,
    });

    try {
      await triggerFollowUp(review.id, factory_id);
    } catch (e) {
      console.error('[WEBHOOK] Follow-up trigger failed:', e.message);
    }

    return { outcome: 'pending_review', id: review.id };
  }

  // Check if all garment types exist in BOM before creating order
  const unknownTypes = await getUnknownGarmentTypes(parsed.items, factory_id);
  if (unknownTypes.length > 0) {
    const availableTypes = await getAvailableGarmentTypes(factory_id);
    await sendUnknownTypeReply({
      factoryId: factory_id,
      buyerEmail: sender,
      buyerName: parsed.buyer_name,
      unknownTypes,
      availableTypes,
      threadId: thread_id,
    });
    const review = await createPendingReview({
      raw_message: raw_message || '',
      source: source || 'email',
      sender_id: sender,
      parsed_result: parsed,
      reason: 'unknown_garment_type',
      factory_id,
      missing_fields: ['unknown_garment_type'],
      followup_needed: false,
      thread_id,
    });
    return { outcome: 'pending_review', id: review.id, unknown_types: unknownTypes };
  }

  // Direct order creation when all fields present — use createOrder for pricing
  try {
    const payload = {
      buyer_name: parsed.buyer_name,
      buyer_contact: parsed.buyer_contact || sender,
      delivery_deadline: parsed.delivery_deadline,
      notes: parsed.special_instructions,
      items: parsed.items || [],
      source,
      buyer_email: sender,
    };
    const order = await createOrder(payload, factory_id);
    return { outcome: 'order_created', id: order.id };
  } catch (err) {
    console.error('[INTAKE] Direct order creation failed:', err.stack || err.message);
    throw err;
  }
}

module.exports = { processIncomingMessage };
