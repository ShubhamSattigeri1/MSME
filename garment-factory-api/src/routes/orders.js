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
    return success(res, await listOrders(req.query, req.factoryId));
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const result = await createOrder(req.body, req.factoryId);
    return success(res, result, 201);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const order = await getOrderById(req.params.id, req.factoryId);

    if (!order) {
      return res.status(404).json({ success: false, error: 'order not found' });
    }

    try {
      const price = await pricingEngine.calculateOrderPrice(req.params.id, { factoryId: req.factoryId });
      return success(res, { ...order, price_breakdown: price });
    } catch (e) {
      return success(res, order);
    }
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/quotation', async (req, res, next) => {
  try {
    const q = await quotationService.generateQuotation(req.params.id, req.factoryId);
    return success(res, q, 201);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id/quotation', async (req, res, next) => {
  try {
    const q = await quotationService.getLastQuotation(req.params.id, req.factoryId);
    if (!q) return res.status(404).json({ success: false, error: 'quotation not found' });
    return success(res, q);
  } catch (err) {
    return next(err);
  }
});

router.put('/:id/status', async (req, res, next) => {
  try {
    const order = await updateOrderStatus(req.params.id, req.body.status, req.factoryId);

    if (!order) {
      return res.status(404).json({ success: false, error: 'order not found' });
    }

    return success(res, order);
  } catch (err) {
    return next(err);
  }
});

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

    const order = await getOrderById(req.params.id, req.factoryId);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.status === 'shipped' || order.status === 'cancelled') {
      return res.status(400).json({ success: false, error: `Cannot negotiate a ${order.status} order` });
    }

    const result = await negotiationService.applyNegotiatedMargin(req.params.id, marginVal, notes || null, req.factoryId);
    return success(res, result);
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/negotiate/reset', async (req, res, next) => {
  try {
    const result = await negotiationService.resetMargin(req.params.id, req.factoryId);
    return success(res, result);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id/negotiate/history', async (req, res, next) => {
  try {
    const history = await negotiationService.getNegotiationHistory(req.params.id, req.factoryId);
    return success(res, history);
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/propose-price', async (req, res, next) => {
  try {
    const { items, notes } = req.body || {};
    const pool = require('../db');
    const factoryId = req.factoryId;

    const order = await getOrderById(req.params.id, factoryId);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.status === 'shipped' || order.status === 'cancelled') {
      return res.status(400).json({ success: false, error: `Cannot propose price for a ${order.status} order` });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items array is required with at least one item' });
    }

    const pendingCheck = await pool.query(
      "SELECT id FROM messages WHERE order_id = $1 AND factory_id = $2 AND message_type = 'price_proposal' AND proposal_status = 'pending'",
      [req.params.id, factoryId]
    );
    if (pendingCheck.rowCount > 0) {
      return res.status(400).json({ success: false, error: 'A price proposal is already pending — buyer must accept or reject first' });
    }

    const settingsRes = await pool.query('SELECT minimum_margin_pct FROM pricing_settings WHERE factory_id = $1 ORDER BY updated_at DESC LIMIT 1', [factoryId]);
    const minimumMarginPct = Number(settingsRes.rows[0]?.minimum_margin_pct ?? 0.05);

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

    const currentPrice = await pricingEngine.calculateOrderPrice(req.params.id, { factoryId });

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

    const itemLines = proposalItems.map(
      (i) => `  ${i.garment_type} (${i.quantity} pcs): ₹${i.original_unit_price} → ₹${i.proposed_unit_price}/pc`
    ).join('\n');

    const msgBody = `Price proposal per item:\n${itemLines}\n\nTotal: ₹${originalTotal.toLocaleString('en-IN')} → ₹${proposedTotal.toLocaleString('en-IN')}${notes ? '\nNote: ' + notes : ''}`;

    const msgRes = await pool.query(
      `INSERT INTO messages (order_id, sender_type, sender_id, body, message_type, proposal_data, proposal_status, factory_id)
       VALUES ($1, 'owner', 'system', $2, 'price_proposal', $3, 'pending', $4)
       RETURNING *`,
      [req.params.id, msgBody, JSON.stringify(proposalData), factoryId]
    );

    return success(res, { message: msgRes.rows[0], proposed_total: proposedTotal });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/email-negotiate', async (req, res, next) => {
  try {
    const { message, proposed_total } = req.body || {};
    const pool = require('../db');
    const { sendEmail } = require('../services/gmailSender');
    const factoryId = req.factoryId;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, error: 'message is required' });
    }
    const proposedTotal = Number(proposed_total);
    if (isNaN(proposedTotal) || proposedTotal <= 0) {
      return res.status(400).json({ success: false, error: 'proposed_total must be a positive number' });
    }

    const order = await getOrderById(req.params.id, factoryId);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    const buyerRes = await pool.query(
      'SELECT email, name FROM buyers WHERE id = $1 AND factory_id = $2',
      [order.buyer_id, factoryId]
    );
    if (buyerRes.rowCount === 0 || !buyerRes.rows[0].email) {
      return res.status(400).json({ success: false, error: 'Buyer email not available for this order' });
    }
    const buyer = buyerRes.rows[0];

    const factoryRes = await pool.query('SELECT name FROM factories WHERE id = $1', [factoryId]);
    const factoryName = factoryRes.rowCount > 0 ? factoryRes.rows[0].name : 'Our Team';

    const emailSubject = `Re: Your Order #${order.id.slice(0, 8).toUpperCase()} - Price Proposal`;
    const emailBody = `Dear ${order.buyer_name},\n\nThank you for your order. We'd like to propose the following:\n\n${message}\n\nProposed total: ₹${proposedTotal.toLocaleString('en-IN')}\n\nPlease reply to this email to accept or reject this proposal.\n\nBest regards,\n${factoryName}`;

    const sent = await sendEmail({
      factoryId,
      to: buyer.email,
      subject: emailSubject,
      body: emailBody,
      threadId: order.thread_id || undefined,
    });

    const proposalData = { proposed_total: proposedTotal, message };

    const msgRes = await pool.query(
      `INSERT INTO messages (order_id, sender_type, sender_id, body, message_type, proposal_data, proposal_status, factory_id)
       VALUES ($1, 'owner', 'system', $2, 'price_proposal', $3, 'pending', $4)
       RETURNING *`,
      [req.params.id, emailBody, JSON.stringify(proposalData), factoryId]
    );

    return res.json({
      success: true,
      data: {
        message_id: sent.messageId,
        thread_id: sent.threadId,
        proposed_total: proposedTotal,
        record: msgRes.rows[0],
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/:orderId/messages/:messageId/respond', async (req, res, next) => {
  try {
    const { action, notes } = req.body || {};
    const pool = require('../db');
    const factoryId = req.factoryId;

    if (!action || !['accept', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, error: 'action must be "accept" or "reject"' });
    }

    const msgRes = await pool.query(
      "SELECT * FROM messages WHERE id = $1 AND order_id = $2 AND factory_id = $3 AND message_type = 'price_proposal'",
      [req.params.messageId, req.params.orderId, factoryId]
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
      await pool.query("UPDATE messages SET proposal_status = 'accepted' WHERE id = $1 AND factory_id = $2", [proposal.id, factoryId]);

      const itemMargins = {};
      for (const pi of (pData.items || [])) {
        itemMargins[pi.order_item_id] = pi.proposed_margin_pct;
      }
      await pricingEngine.calculateOrderPrice(req.params.orderId, { item_margins: itemMargins, factoryId });

      const avgMargin = pData.items && pData.items.length
        ? Number((pData.items.reduce((s, i) => s + Number(i.proposed_margin_pct), 0) / pData.items.length).toFixed(4))
        : null;
      await pool.query(
        "UPDATE orders SET status = 'confirmed', negotiated_margin_pct = $1, updated_at = NOW() WHERE id = $2 AND factory_id = $3",
        [avgMargin, req.params.orderId, factoryId]
      );

      const newTotal = pData.proposed_total;
      await require('../services/messaging').sendMessage(req.params.orderId, 'owner', `Price proposal accepted. New total: ₹${newTotal.toLocaleString('en-IN')}.`, { senderId: 'system', factoryId });

      const updatedOrder = await getOrderById(req.params.orderId, factoryId);
      let priceBreakdown = null;
      try {
        priceBreakdown = await pricingEngine.calculateOrderPrice(req.params.orderId, { item_margins: itemMargins, factoryId });
      } catch (e) { /* non-critical */ }

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
      await pool.query("UPDATE messages SET proposal_status = 'rejected' WHERE id = $1 AND factory_id = $2", [proposal.id, factoryId]);
      await require('../services/messaging').sendMessage(req.params.orderId, 'owner', `Price proposal rejected.${notes ? ' Reason: ' + notes : ''}`, { senderId: 'system', factoryId });

      try {
        const { getIO } = require('../socket');
        const io = getIO();
        if (io) {
          io.to(`order_${req.params.orderId}`).emit('order_updated', { order: await getOrderById(req.params.orderId, factoryId) });
        }
      } catch (e) { /* non-critical */ }

      return success(res, { action, message_id: proposal.id });
    }
  } catch (err) {
    return next(err);
  }
});

router.post('/suggest-deadline', async (req, res, next) => {
  try {
    const result = await suggestDeadline(req.body, req.factoryId);
    return success(res, result);
  } catch (err) {
    return next(err);
  }
});

router.put('/:id/accept-deadline', async (req, res, next) => {
  try {
    const orderRes = await require('../db').query(
      'SELECT suggested_deadline FROM orders WHERE id = $1 AND factory_id = $2',
      [req.params.id, req.factoryId]
    );
    if (orderRes.rowCount === 0) return res.status(404).json({ success: false, error: 'Order not found' });
    if (!orderRes.rows[0].suggested_deadline) return res.status(400).json({ success: false, error: 'No suggested deadline to accept' });

    const updated = await require('../db').query(
      'UPDATE orders SET delivery_deadline = suggested_deadline, updated_at = NOW() WHERE id = $1 AND factory_id = $2 RETURNING *',
      [req.params.id, req.factoryId]
    );
    return success(res, updated.rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;