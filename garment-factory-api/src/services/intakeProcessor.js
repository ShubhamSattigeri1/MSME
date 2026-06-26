const pool = require('../db');
const { parseOrderMessage } = require('./orderParser');
const insertOrder = require('../db/insertOrder');
const { createPendingReview } = require('./pendingReview');
const { triggerFollowUp } = require('./followUpNotifier');

async function processIncomingMessage({ factory_id, source, sender, raw_message, thread_id }) {
  const parsed = await parseOrderMessage(raw_message);

  if (parsed.error === 'api_error') {
    await createPendingReview({
      raw_message,
      source,
      sender_id: sender,
      parsed_result: parsed,
      reason: 'api_error',
      factory_id,
      followup_needed: true,
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
    });

    try {
      await triggerFollowUp(review.id, factory_id);
    } catch (e) {
      console.error('[WEBHOOK] Follow-up trigger failed:', e.message);
    }

    return { outcome: 'pending_review', id: review.id };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const payload = {
      buyer_name: parsed.buyer_name,
      buyer_contact: parsed.buyer_contact,
      delivery_deadline: parsed.delivery_deadline,
      notes: parsed.special_instructions,
      items: parsed.items || [],
      source,
    };
    const orderId = await insertOrder(client, payload, factory_id);

    await client.query('COMMIT');

    return { outcome: 'order_created', id: orderId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { processIncomingMessage };