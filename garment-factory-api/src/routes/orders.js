const express = require('express');
const {
  createOrder,
  getOrderById,
  listOrders,
  updateOrderStatus,
} = require('../services/orders');

const pricingEngine = require('../services/pricingEngine');
const quotationService = require('../services/quotationGenerator');
const negotiationService = require('../services/negotiation');
const { suggestDeadline } = require('../services/deadlineEngine');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

router.get('/', async (req, res, next) => {
  try {
    return success(res, await listOrders(req.query));
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const result = await createOrder(req.body);
    return success(res, result, 201);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const order = await getOrderById(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, error: 'order not found' });
    }

    // include price breakdown: recalculate if total_price is null
    try {
      const price = await pricingEngine.calculateOrderPrice(req.params.id);
      return success(res, { ...order, price_breakdown: price });
    } catch (e) {
      // if pricing fails, still return order
      return success(res, order);
    }
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/quotation', async (req, res, next) => {
  try {
    const q = await quotationService.generateQuotation(req.params.id);
    return success(res, q, 201);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id/quotation', async (req, res, next) => {
  try {
    const q = await quotationService.getLastQuotation(req.params.id);
    if (!q) return res.status(404).json({ success: false, error: 'quotation not found' });
    return success(res, q);
  } catch (err) {
    return next(err);
  }
});

router.put('/:id/status', async (req, res, next) => {
  try {
    const order = await updateOrderStatus(req.params.id, req.body.status);

    if (!order) {
      return res.status(404).json({ success: false, error: 'order not found' });
    }

    return success(res, order);
  } catch (err) {
    return next(err);
  }
});

// POST /api/orders/:id/negotiate
router.post('/:id/negotiate', async (req, res, next) => {
  try {
    const { margin_pct, notes } = req.body || {};
    if (margin_pct === undefined || margin_pct === null) {
      return res.status(400).json({ success: false, error: 'margin_pct is required' });
    }
    const marginVal = Number(margin_pct);
    if (isNaN(marginVal) || marginVal < 0 || marginVal > 1) {
      return res.status(400).json({ success: false, error: 'margin_pct must be a number between 0 and 1' });
    }

    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.status === 'shipped' || order.status === 'cancelled') {
      return res.status(400).json({ success: false, error: `Cannot negotiate a ${order.status} order` });
    }

    const result = await negotiationService.applyNegotiatedMargin(req.params.id, marginVal, notes || null);
    return success(res, result);
  } catch (err) {
    return next(err);
  }
});

// POST /api/orders/:id/negotiate/reset
router.post('/:id/negotiate/reset', async (req, res, next) => {
  try {
    const result = await negotiationService.resetMargin(req.params.id);
    return success(res, result);
  } catch (err) {
    return next(err);
  }
});

// GET /api/orders/:id/negotiate/history
router.get('/:id/negotiate/history', async (req, res, next) => {
  try {
    const history = await negotiationService.getNegotiationHistory(req.params.id);
    return success(res, history);
  } catch (err) {
    return next(err);
  }
});

// POST /api/orders/:id/propose-price — owner proposes per-item prices to buyer via chat
router.post('/:id/propose-price', async (req, res, next) => {
  try {
    const { items, notes } = req.body || {};
    const pool = require('../db');

    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.status === 'shipped' || order.status === 'cancelled') {
      return res.status(400).json({ success: false, error: `Cannot propose price for a ${order.status} order` });
    }

    // items must be an array: [{ order_item_id, garment_type, margin_pct }]
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items array is required with at least one item' });
    }

    // Reject if there's already a pending proposal
    const pendingCheck = await pool.query(
      "SELECT id FROM messages WHERE order_id = $1 AND message_type = 'price_proposal' AND proposal_status = 'pending'",
      [req.params.id]
    );
    if (pendingCheck.rowCount > 0) {
      return res.status(400).json({ success: false, error: 'A price proposal is already pending — buyer must accept or reject first' });
    }

    // Get pricing settings for margin floor
    const settingsRes = await pool.query('SELECT minimum_margin_pct FROM pricing_settings ORDER BY updated_at DESC LIMIT 1');
    const minimumMarginPct = Number(settingsRes.rows[0]?.minimum_margin_pct ?? 0.05);

    // Validate each item's margin
    const itemMargins = {};
    for (const item of items) {
      if (!item.order_item_id) return res.status(400).json({ success: false, error: 'Each item must have an order_item_id' });
      const marginVal = Number(item.margin_pct);
      if (isNaN(marginVal) || marginVal < 0 || marginVal > 1) {
        return res.status(400).json({ success: false, error: `margin_pct for item ${item.order_item_id} must be between 0 and 1` });
      }
      if (marginVal < minimumMarginPct) {
        return res.status(400).json({ success: false, error: `Margin for ${item.garment_type || item.order_item_id} cannot be below minimum floor: ${(minimumMarginPct * 100).toFixed(1)}%` });
      }
      itemMargins[item.order_item_id] = marginVal;
    }

    // Get current prices (before proposal)
    const currentPrice = await pricingEngine.calculateOrderPrice(req.params.id);

    // Build per-item proposal data
    const proposalItems = currentPrice.items.map((cp) => {
      const proposedMargin = itemMargins[cp.order_item_id] ?? cp.margin_pct;
      const costBeforeMargin = cp.material_cost + cp.wastage_cost + cp.labour_cost + cp.overhead_cost;
      const proposedTotal = costBeforeMargin * (1 + proposedMargin);
      return {
        order_item_id: cp.order_item_id,
        garment_type: cp.garment_type,
        quantity: cp.quantity,
        original_unit_price: cp.unit_price,
        original_item_total: cp.item_total,
        proposed_margin_pct: proposedMargin,
        proposed_unit_price: Number((proposedTotal / cp.quantity).toFixed(2)),
        proposed_item_total: Number(proposedTotal.toFixed(2)),
      };
    });

    const originalTotal = currentPrice.order_total;
    const proposedTotal = proposalItems.reduce((s, i) => s + i.proposed_item_total, 0);

    const proposalData = {
      items: proposalItems,
      original_total: originalTotal,
      proposed_total: proposedTotal,
      notes: notes || null,
    };

    // Build human-readable body
    const itemLines = proposalItems.map(
      (i) => `  ${i.garment_type} (${i.quantity} pcs): ₹${i.original_unit_price} → ₹${i.proposed_unit_price}/pc`
    ).join('\n');

    const msgBody = `Price proposal per item:\n${itemLines}\n\nTotal: ₹${originalTotal.toLocaleString('en-IN')} → ₹${proposedTotal.toLocaleString('en-IN')}${notes ? '\nNote: ' + notes : ''}`;

    const msgRes = await pool.query(
      `INSERT INTO messages (order_id, sender_type, sender_id, body, message_type, proposal_data, proposal_status)
       VALUES ($1, 'owner', 'system', $2, 'price_proposal', $3, 'pending')
       RETURNING *`,
      [req.params.id, msgBody, JSON.stringify(proposalData)]
    );

    return success(res, { message: msgRes.rows[0], proposed_total: proposedTotal });
  } catch (err) {
    return next(err);
  }
});

// POST /api/orders/:orderId/messages/:messageId/respond — owner responds to buyer's price proposal
router.post('/:orderId/messages/:messageId/respond', async (req, res, next) => {
  try {
    const { action, notes } = req.body || {};
    const pool = require('../db');

    if (!action || !['accept', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, error: 'action must be "accept" or "reject"' });
    }

    const msgRes = await pool.query(
      "SELECT * FROM messages WHERE id = $1 AND order_id = $2 AND message_type = 'price_proposal'",
      [req.params.messageId, req.params.orderId]
    );
    if (msgRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Price proposal not found' });
    }
    const proposal = msgRes.rows[0];
    if (proposal.proposal_status !== 'pending') {
      return res.status(400).json({ success: false, error: 'This proposal has already been responded to' });
    }

    const pData = typeof proposal.proposal_data === 'string' ? JSON.parse(proposal.proposal_data) : proposal.proposal_data;

    if (action === 'accept') {
      await pool.query("UPDATE messages SET proposal_status = 'accepted' WHERE id = $1", [proposal.id]);

      // Apply per-item margins
      const itemMargins = {};
      for (const pi of (pData.items || [])) {
        itemMargins[pi.order_item_id] = pi.proposed_margin_pct;
      }
      await pricingEngine.calculateOrderPrice(req.params.orderId, { item_margins: itemMargins });

      // Update order status and negotiated_margin_pct
      const avgMargin = pData.items && pData.items.length
        ? Number((pData.items.reduce((s, i) => s + Number(i.proposed_margin_pct), 0) / pData.items.length).toFixed(4))
        : null;
      await pool.query(
        "UPDATE orders SET status = 'confirmed', negotiated_margin_pct = $1, updated_at = NOW() WHERE id = $2",
        [avgMargin, req.params.orderId]
      );

      const newTotal = pData.proposed_total;
      await require('../services/messaging').sendMessage(req.params.orderId, 'owner', `Price proposal accepted. New total: ₹${newTotal.toLocaleString('en-IN')}.`, { senderId: 'system' });

      // Fetch updated order with price_breakdown
      const updatedOrder = await getOrderById(req.params.orderId);
      let priceBreakdown = null;
      try {
        priceBreakdown = await pricingEngine.calculateOrderPrice(req.params.orderId, { item_margins: itemMargins });
      } catch (e) { /* non-critical */ }

      // Emit order_updated so both dashboard and buyer portal refresh
      try {
        const { getIO } = require('../socket');
        const io = getIO();
        if (io) {
          io.to(`order_${req.params.orderId}`).emit('order_updated', { order: { ...updatedOrder, price_breakdown: priceBreakdown } });
        }
      } catch (e) { /* non-critical */ }

      return success(res, {
        action,
        message_id: proposal.id,
        order: { ...updatedOrder, price_breakdown: priceBreakdown },
        new_total_price: newTotal,
      });
    } else {
      await pool.query("UPDATE messages SET proposal_status = 'rejected' WHERE id = $1", [proposal.id]);
      await require('../services/messaging').sendMessage(req.params.orderId, 'owner', `Price proposal rejected.${notes ? ' Reason: ' + notes : ''}`, { senderId: 'system' });

      // Emit order_updated so proposal status refreshes in real time
      try {
        const { getIO } = require('../socket');
        const io = getIO();
        if (io) {
          io.to(`order_${req.params.orderId}`).emit('order_updated', { order: await getOrderById(req.params.orderId) });
        }
      } catch (e) { /* non-critical */ }

      return success(res, { action, message_id: proposal.id });
    }
  } catch (err) {
    return next(err);
  }
});

// POST /api/orders/suggest-deadline
router.post('/suggest-deadline', async (req, res, next) => {
  try {
    const result = await suggestDeadline(req.body);
    return success(res, result);
  } catch (err) {
    return next(err);
  }
});

// PUT /api/orders/:id/accept-deadline
router.put('/:id/accept-deadline', async (req, res, next) => {
  try {
    const orderRes = await require('../db').query(
      'SELECT suggested_deadline FROM orders WHERE id = $1',
      [req.params.id]
    );
    if (orderRes.rowCount === 0) return res.status(404).json({ success: false, error: 'Order not found' });
    if (!orderRes.rows[0].suggested_deadline) return res.status(400).json({ success: false, error: 'No suggested deadline to accept' });

    const updated = await require('../db').query(
      'UPDATE orders SET delivery_deadline = suggested_deadline, updated_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    return success(res, updated.rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
