const express = require('express');
const pool = require('../db');
const ownerAuth = require('../middleware/ownerAuth');
const { parseOrderMessage } = require('../services/orderParser');
const insertOrder = require('../db/insertOrder');
const { createOrder } = require('../services/orders');
const { normalizeSize } = require('../services/skuResolver');
const { checkAvailability } = require('../services/materials');
const { suggestDeadline } = require('../services/deadlineEngine');
const {
  createPendingReview,
  dismissPendingReview,
  getPendingReviewById,
  listUnreviewed,
  listPendingByFactory,
  markReviewed,
} = require('../services/pendingReview');
const { sendFollowUpReply, triggerFollowUp } = require('../services/followUpNotifier');
const { FOLLOWUP_QUESTIONS } = require('../services/orderParser');
const { processIncomingMessage } = require('../services/intakeProcessor');

const router = express.Router();

// Shared helper: generate follow-up message from missing_fields array
function buildFollowupMessage(missingFields, reviewId) {
  const missing = typeof missingFields === 'string' ? JSON.parse(missingFields) : (missingFields || []);
  const questions = missing.map(field => {
    if (FOLLOWUP_QUESTIONS[field]) return FOLLOWUP_QUESTIONS[field];

    if (field.startsWith('items[') && field.endsWith('].garment_type')) {
      return 'What type of garment would you like to order?';
    }
    if (field.startsWith('items[') && field.endsWith('].quantity')) {
      return 'How many pieces do you need?';
    }
    if (field.startsWith('items[') && field.endsWith('].fabric_type')) {
      return 'What fabric type do you need? (e.g. cotton, polyester, linen)';
    }
    if (field.startsWith('items[') && field.endsWith('].colour')) {
      return 'What colour(s) do you need?';
    }
    if (field.startsWith('items[') && field.endsWith('].size_breakdown')) {
      return 'Could you share the size-wise quantity split? (e.g. S:100, M:200, L:150)';
    }

    if (field === 'buyer_name') return 'Could you share your name?';
    if (field === 'buyer_contact') return 'Could you share your email or phone number?';
    if (field === 'delivery_deadline') return 'When do you need this order delivered by?';
    if (field === 'items') return 'What items would you like to order?';

    return `Please provide ${field.replace(/[\[\]]/g, ' ').replace(/\./g, ' ')}`;
  }).filter(Boolean);

  if (questions.length === 0) return null;

  let message = `Hi! Thanks for your order. To process it, could you please share a few more details:\n\n${questions.map(q => `• ${q}`).join('\n')}\n\nThanks!`;

  if (reviewId) {
    const ref = `MSME-${reviewId.slice(-8)}`;
    message += `\n\n---\nOrder Ref: ${ref}\nPlease keep this reference in your reply for faster processing.`;
  }

  return message;
}

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function failure(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

function toOrderPayload(parsed) {
  return {
    buyer_name: parsed.buyer_name,
    buyer_contact: parsed.buyer_contact,
    delivery_deadline: parsed.delivery_deadline,
    notes: parsed.special_instructions,
    items: parsed.items || [],
  };
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

// Existing public routes

router.post('/order', async (req, res, next) => {
  const { source, raw_message: rawMessage, sender_id: senderId } = req.body || {};

  try {
    if (!['email', 'whatsapp'].includes(source)) {
      return failure(res, 'source must be email or whatsapp');
    }

    if (!rawMessage || typeof rawMessage !== 'string') {
      return failure(res, 'raw_message is required');
    }

    const parsed = await parseOrderMessage(rawMessage);

    if (parsed.error === 'api_error') {
      await createPendingReview({
        raw_message: rawMessage,
        source,
        sender_id: senderId,
        parsed_result: parsed,
        reason: 'api_error',
      });

      return success(res, { received: true, needs_review: true });
    }

    if (!parsed.is_order) {
      return success(res, { received: true, is_order: false });
    }

    if (parsed.confidence === 'low') {
      await createPendingReview({
        raw_message: rawMessage,
        source,
        sender_id: senderId,
        parsed_result: parsed,
        reason: 'low_confidence',
      });

      return success(res, { received: true, needs_review: true });
    }

    if (parsed.needs_followup) {
      await createPendingReview({
        raw_message: rawMessage,
        source,
        sender_id: senderId,
        parsed_result: parsed,
        reason: 'missing_fields',
      });

      return success(res, {
        received: true,
        needs_followup: true,
        questions: parsed.followup_questions || [],
      });
    }

    const order = await createOrder(toOrderPayload(parsed));
    const availabilityResult = await checkAvailability(order.items);

    let deadlineSuggestion = null;
    try {
      deadlineSuggestion = await suggestDeadline({ items: order.items });
      if (deadlineSuggestion && deadlineSuggestion.suggested_deadline) {
        await pool.query(
          `UPDATE orders SET suggested_deadline = $1, deadline_suggestion_factors = $2::jsonb WHERE id = $3::uuid`,
          [deadlineSuggestion.suggested_deadline, JSON.stringify(deadlineSuggestion.breakdown || {}), order.id]
        );
      }
    } catch (e) {
      console.error('[DEADLINE] Failed to suggest deadline:', e.message);
    }

    try {
      const notifier = require('../services/notifier');
      await notifier.sendOrderReceived(order);
    } catch (e) {
      console.error('[NOTIFY] Failed to send order received notification:', e.message);
    }

    return success(res, {
      received: true,
      order_id: order.id,
      availability_result: availabilityResult,
      suggested_deadline: deadlineSuggestion?.suggested_deadline || null,
      deadline_breakdown: deadlineSuggestion?.breakdown || null,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/pending-review', async (req, res, next) => {
  try {
    return success(res, await listUnreviewed());
  } catch (err) {
    return next(err);
  }
});

router.put('/pending-review/:id', async (req, res, next) => {
  try {
    const pendingReview = await getPendingReviewById(req.params.id);

    if (!pendingReview || pendingReview.reviewed) {
      return failure(res, 'pending review item not found', 404);
    }

    const mergedResult = deepMerge(pendingReview.parsed_result || {}, req.body || {});
    const order = await createOrder(toOrderPayload(mergedResult));
    await markReviewed(req.params.id);

    return success(res, {
      order_id: order.id,
    });
  } catch (err) {
    return next(err);
  }
});

router.delete('/pending-review/:id', async (req, res, next) => {
  try {
    const dismissed = await dismissPendingReview(req.params.id);

    if (!dismissed) {
      return failure(res, 'pending review item not found', 404);
    }

    return success(res, { reviewed: true });
  } catch (err) {
    return next(err);
  }
});

// Feature 2: Make.com webhook endpoint (PUBLIC)
// During development, use ngrok: ngrok http 3000 to get a public URL for Make.com

router.post('/webhook', async (req, res, next) => {
  try {
    console.log('[WEBHOOK DEBUG]', JSON.stringify(req.body, null, 2));
    const { factory_id, source, sender, raw_message, webhook_secret } = req.body;

    if (webhook_secret !== process.env.MAKE_WEBHOOK_SECRET) {
      return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
    }

    if (!factory_id) {
      return res.status(400).json({ success: false, error: 'factory_id is required' });
    }

    if (!source || !['gmail', 'whatsapp'].includes(source)) {
      return res.status(400).json({ success: false, error: 'source must be gmail or whatsapp' });
    }

    if (!raw_message || typeof raw_message !== 'string') {
      return res.status(400).json({ success: false, error: 'raw_message is required' });
    }

    const factoryCheck = await pool.query('SELECT id FROM factories WHERE id = $1', [factory_id]);
    if (factoryCheck.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Factory not found' });
    }

    const result = await processIncomingMessage({
      factory_id,
      source,
      sender,
      raw_message,
      thread_id: req.body.thread_id,
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    return next(err);
  }
});

// Feature 2: Factory-scoped pending list (PROTECTED)

router.get('/pending', ownerAuth, async (req, res, next) => {
  try {
    const rows = await listPendingByFactory(req.factoryId);
    return success(res, rows);
  } catch (err) {
    return next(err);
  }
});

// Feature 2: Trigger follow-up for a pending review (PROTECTED)

router.post('/pending/:id/followup', ownerAuth, async (req, res, next) => {
  try {
    const review = await getPendingReviewById(req.params.id);
    if (!review) {
      return failure(res, 'Pending review not found', 404);
    }
    if (review.factory_id !== req.factoryId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const result = await triggerFollowUp(req.params.id, req.factoryId);
    return success(res, result);
  } catch (err) {
    return next(err);
  }
});

// Feature 2: Approve pending review -> create order (PROTECTED)

router.post('/pending/:id/approve', ownerAuth, async (req, res, next) => {
  try {
    const review = await getPendingReviewById(req.params.id);
    if (!review) {
      return failure(res, 'Pending review not found', 404);
    }
    if (review.factory_id !== req.factoryId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    if (review.reviewed) {
      return failure(res, 'Pending review already processed', 400);
    }

    const { buyer_name, items, delivery_deadline, notes } = req.body || {};

    if (!buyer_name || !items || !Array.isArray(items) || items.length === 0) {
      return failure(res, 'buyer_name and items (non-empty array) are required');
    }

    for (const item of items) {
      if (!item.garment_type || !item.quantity) {
        return failure(res, 'Each item must have garment_type and quantity');
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const payload = {
        buyer_name,
        buyer_contact: review.sender_id || null,
        delivery_deadline: delivery_deadline || null,
        notes: notes || null,
        source: review.source || 'manual',
        items: items.map(item => ({
          garment_type: item.garment_type,
          fabric_type: item.fabric_type || null,
          colour: item.colour || null,
          quantity: item.quantity,
          size_breakdown: item.size_breakdown || null,
          unit_price: item.unit_price || null,
          special_notes: item.special_notes || null,
        })),
      };

      const orderId = await insertOrder(client, payload, req.factoryId);

      await client.query(
        `UPDATE pending_review SET reviewed = true WHERE id = $1`,
        [req.params.id]
      );

      await client.query('COMMIT');

      const order = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
      return success(res, order.rows[0], 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    return next(err);
  }
});

// Feature 2: Reject pending review (PROTECTED)

router.post('/pending/:id/reject', ownerAuth, async (req, res, next) => {
  try {
    const review = await getPendingReviewById(req.params.id);
    if (!review) {
      return failure(res, 'Pending review not found', 404);
    }
    if (review.factory_id !== req.factoryId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    if (review.reviewed) {
      return failure(res, 'Pending review already processed', 400);
    }

    await pool.query(
      `UPDATE pending_review SET reviewed = true, reason = 'rejected' WHERE id = $1`,
      [req.params.id]
    );

    return success(res, { success: true });
  } catch (err) {
    return next(err);
  }
});

// NEW: GET /api/intake/followups/due — PUBLIC (Make.com polls this)
router.get('/followups/due', async (req, res, next) => {
  try {
    const secret = req.query.webhook_secret || req.headers['x-webhook-secret'];
    if (secret !== process.env.MAKE_WEBHOOK_SECRET) {
      return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
    }

    const result = await pool.query(
      `SELECT id, factory_id, source, sender_id, missing_fields
       FROM pending_review
       WHERE followup_needed = true AND followup_sent = false AND reviewed = false`
    );

    const followups = result.rows.map(row => {
      const message = buildFollowupMessage(row.missing_fields, row.id);
      return message ? {
        id: row.id,
        source: row.source,
        sender: row.sender_id,
        message,
        factory_id: row.factory_id,
      } : null;
    }).filter(Boolean);

    return res.json({ success: true, data: followups });
  } catch (err) {
    return next(err);
  }
});

// NEW: POST /api/intake/followups/:id/sent — PUBLIC (Make.com confirms send)
router.post('/followups/:id/sent', async (req, res, next) => {
  try {
    const { webhook_secret } = req.body || {};
    if (webhook_secret !== process.env.MAKE_WEBHOOK_SECRET) {
      return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
    }

    await pool.query(
      `UPDATE pending_review SET followup_sent = true, followup_at = NOW() WHERE id = $1`,
      [req.params.id]
    );

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// NEW: GET /api/intake/pending/:id/followup-draft — PROTECTED (owner clicks button in dashboard)
router.get('/pending/:id/followup-draft', ownerAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, factory_id, source, sender_id, missing_fields
       FROM pending_review
       WHERE id = $1 AND factory_id = $2`,
      [req.params.id, req.factoryId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Pending review not found' });
    }

    const row = result.rows[0];
    const message = buildFollowupMessage(row.missing_fields, row.id);

    if (!message) {
      return res.status(400).json({ success: false, error: 'No missing fields to follow up on' });
    }

    return res.json({
      success: true,
      data: {
        to: row.source === 'gmail' ? row.sender_id : null,
        subject: 'Quick question about your order',
        body: message,
        source: row.source,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// SKU Issues: orders with complete item data but no matching SKU
router.get('/sku-issues', ownerAuth, async (req, res, next) => {
  try {
    const factoryId = req.factoryId;

    // 1. Get ALL active SKUs for this factory with their attribute sets
    const skusRes = await pool.query(
      `SELECT id, sku_code, attribute_set FROM product_skus WHERE factory_id = $1 AND active = 1`,
      [factoryId]
    );
    const skus = skusRes.rows.map(s => ({
      ...s,
      attributes: typeof s.attribute_set === 'string' ? JSON.parse(s.attribute_set) : s.attribute_set,
    }));

    // 2. Find orders in pending/confirmed status with items lacking sku_id
    const itemsRes = await pool.query(
      `SELECT oi.id AS item_id, oi.order_id, oi.garment_type, oi.fabric_type, oi.colour,
              oi.quantity, oi.size_breakdown, oi.sku_id,
              o.buyer_name, o.status, o.created_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.factory_id = $1
         AND o.status IN ('pending', 'confirmed')
         AND oi.sku_id IS NULL`,
      [factoryId]
    );

    // 3. Group by order and determine which items are "unmatched"
    const orderMap = new Map();
    for (const item of itemsRes.rows) {
      // Determine size from size_breakdown keys
      let size = 'standard';
      if (item.size_breakdown) {
        const sb = typeof item.size_breakdown === 'string' ? JSON.parse(item.size_breakdown) : item.size_breakdown;
        const keys = Object.keys(sb).filter(k => Number(sb[k]) > 0);
        if (keys.length === 1) size = keys[0];
        else if (keys.length > 1) size = 'multi'; // can't resolve to single SKU
      }

      const hasCompleteData = item.fabric_type && item.fabric_type !== ''
        && item.colour && item.colour !== '';
      const missingFields = [];
      if (!item.fabric_type) missingFields.push('fabric_type');
      if (!item.colour) missingFields.push('colour');
      if (!item.garment_type) missingFields.push('garment_type');

      // Try to match to an existing SKU (must match garment_type + colour + fabric + size)
      const matchedSku = hasCompleteData
        ? skus.find(s => {
            const a = s.attributes;
            return a.garment_type === item.garment_type
                && a.color === item.colour
                && a.material === item.fabric_type
                && (!a.size || normalizeSize(a.size) === normalizeSize(size));
          })
        : null;

      const orderId = item.order_id;
      if (!orderMap.has(orderId)) {
        const orderRes = await pool.query(
          'SELECT id, buyer_name, buyer_contact, status, created_at FROM orders WHERE id = $1',
          [orderId]
        );
        if (orderRes.rowCount === 0) continue;
        orderMap.set(orderId, {
          ...orderRes.rows[0],
          items: [],
        });
      }
      const order = orderMap.get(orderId);
      order.items.push({
        item_id: item.item_id,
        garment_type: item.garment_type,
        fabric_type: item.fabric_type,
        colour: item.colour,
        quantity: item.quantity,
        size_breakdown: item.size_breakdown,
        resolved_size: size,
        matched_sku: matchedSku ? { id: matchedSku.id, sku_code: matchedSku.sku_code } : null,
        data_complete: hasCompleteData,
        missing_fields: missingFields,
      });
    }

    // Separate matched (can auto-assign) vs unmatched
    const unmatchedOrders = [];
    const autoAssignOrders = [];

    for (const order of orderMap.values()) {
      const unmatched = order.items.filter(i => !i.matched_sku);
      const matched = order.items.filter(i => i.matched_sku);

      if (unmatched.length > 0) {
        unmatchedOrders.push({ ...order, items: unmatched, matched_count: matched.length });
      }
      if (matched.length > 0) {
        autoAssignOrders.push({ ...order, items: matched });
      }
    }

    return success(res, {
      unmatched_items: unmatchedOrders,
      auto_assign: autoAssignOrders,
      total_skus: skus.length,
    });
  } catch (err) {
    return next(err);
  }
});

// Auto-assign SKUs to order items that match an existing SKU
router.post('/sku-issues/auto-assign', ownerAuth, async (req, res, next) => {
  try {
    const factoryId = req.factoryId;

    const skusRes = await pool.query(
      `SELECT id, sku_code, attribute_set FROM product_skus WHERE factory_id = $1 AND active = 1`,
      [factoryId]
    );
    const skus = skusRes.rows.map(s => ({
      ...s,
      attributes: typeof s.attribute_set === 'string' ? JSON.parse(s.attribute_set) : s.attribute_set,
    }));

    const itemsRes = await pool.query(
      `SELECT oi.id AS item_id, oi.order_id, oi.garment_type, oi.fabric_type, oi.colour,
              oi.quantity, oi.size_breakdown
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.factory_id = $1
         AND o.status IN ('pending', 'confirmed')
         AND oi.sku_id IS NULL
         AND oi.fabric_type IS NOT NULL AND oi.fabric_type != ''
         AND oi.colour IS NOT NULL AND oi.colour != ''`,
      [factoryId]
    );

    let assigned = 0;
    for (const item of itemsRes.rows) {
      let size = 'standard';
      if (item.size_breakdown) {
        const sb = typeof item.size_breakdown === 'string' ? JSON.parse(item.size_breakdown) : item.size_breakdown;
        const keys = Object.keys(sb).filter(k => Number(sb[k]) > 0);
        if (keys.length === 1) size = keys[0];
        else if (keys.length > 1) size = 'multi';
      }

      const matchedSku = skus.find(s => {
        const a = s.attributes;
        return a.garment_type === item.garment_type
            && a.color === item.colour
            && a.material === item.fabric_type
            && (!a.size || normalizeSize(a.size) === normalizeSize(size));
      });

      if (matchedSku) {
        await pool.query(
          `UPDATE order_items SET sku_id = $1 WHERE id = $2`,
          [matchedSku.id, item.item_id]
        );
        assigned += 1;
      }
    }

    return success(res, { assigned });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
