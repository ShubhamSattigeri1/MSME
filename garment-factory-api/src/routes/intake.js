const express = require('express');
const pool = require('../db');
const { parseOrderMessage } = require('../services/orderParser');
const { createOrder } = require('../services/orders');
const { checkAvailability } = require('../services/materials');
const { suggestDeadline } = require('../services/deadlineEngine');
const {
  createPendingReview,
  dismissPendingReview,
  getPendingReviewById,
  listUnreviewed,
  markReviewed,
} = require('../services/pendingReview');

const router = express.Router();

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

module.exports = router;
