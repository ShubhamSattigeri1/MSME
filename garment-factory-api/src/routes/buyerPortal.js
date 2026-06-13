const express = require('express');
const buyerAuth = require('../middleware/buyerAuth');
const { createBuyerAccount, loginBuyer } = require('../services/buyerAuth');
const { findOrCreateBuyer, getBuyerById } = require('../services/buyers');
const { createOrder, getOrderById, listOrders } = require('../services/orders');
const { getMessages, sendMessage, markMessagesRead, getUnreadCount } = require('../services/messaging');
const { suggestDeadline } = require('../services/deadlineEngine');
const pricingEngine = require('../services/pricingEngine');
const notifier = require('../services/notifier');
const pool = require('../db');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function failure(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

// POST /api/buyer-portal/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, buyer_name } = req.body || {};
    if (!email || !password || !buyer_name) return failure(res, 'email, password, and buyer_name are required');
    if (password.length < 6) return failure(res, 'Password must be at least 6 characters');
    const existingAccount = await pool.query('SELECT id FROM buyer_accounts WHERE email = $1', [email]);
    if (existingAccount.rowCount > 0) return failure(res, 'An account with this email already exists');
    const buyer = await findOrCreateBuyer({ name: buyer_name, email });
    const account = await createBuyerAccount(buyer.id, email, password);
    const { loginBuyer: doLogin } = require('../services/buyerAuth');
    const result = await doLogin(email, password);
    return success(res, { ...result, buyer_name: buyer.name }, 201);
  } catch (err) {
    return next(err);
  }
});

// POST /api/buyer-portal/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return failure(res, 'email and password are required');
    const result = await loginBuyer(email, password);
    return success(res, result);
  } catch (err) {
    if (err.message === 'Invalid email or password') {
      return res.status(401).json({ success: false, error: err.message });
    }
    return next(err);
  }
});

// POST /api/buyer-portal/orders — place a new order
router.post('/orders', buyerAuth, async (req, res, next) => {
  try {
    const { items, delivery_deadline, special_instructions } = req.body || {};

    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return failure(res, 'items must be a non-empty array');
    }
    for (const item of items) {
      if (!item.garment_type) return failure(res, 'Each item must have a garment_type');
      if (!item.quantity || Number(item.quantity) <= 0) return failure(res, 'Each item must have a quantity greater than 0');
    }

    // Validate delivery_deadline
    if (!delivery_deadline) {
      return failure(res, 'delivery_deadline is required');
    }
    const deadlineDate = new Date(delivery_deadline);
    if (isNaN(deadlineDate.getTime())) {
      return failure(res, 'delivery_deadline must be a valid date');
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const minDeadline = new Date(today);
    minDeadline.setDate(minDeadline.getDate() + 14);
    if (deadlineDate < minDeadline) {
      return failure(res, 'Delivery deadline must be at least 14 days from today');
    }

    // Load buyer profile
    const buyer = await getBuyerById(req.buyer.buyer_id);
    if (!buyer) return failure(res, 'Buyer profile not found', 404);

    // Build parsedOrder (same shape as AI parser produces)
    const parsedOrder = {
      buyer_name: buyer.name,
      buyer_contact: buyer.email || buyer.phone,
      delivery_deadline,
      special_instructions: special_instructions || null,
      items,
      source: 'buyer_portal',
    };

    // Create order using the same service as all other sources
    const result = await createOrder(parsedOrder);
    const newOrder = result;

    // Get full order with items
    const order = await getOrderById(newOrder.id);

    // Suggest deadline and store on order
    let suggestion = null;
    try {
      suggestion = await suggestDeadline({ items });
      if (suggestion && suggestion.suggested_deadline) {
        await pool.query(
          `UPDATE orders SET
             suggested_deadline = $1,
             deadline_suggestion_factors = $2,
             updated_at = NOW()
           WHERE id = $3`,
          [suggestion.suggested_deadline, JSON.stringify(suggestion.breakdown), order.id]
        );
      }
    } catch (e) {
      console.error('[BUYER-PORTAL] Deadline suggestion failed:', e.message);
    }

    // Send owner notification email (never fail the order)
    try {
      await notifier.sendNewPortalOrder(order, buyer);
    } catch (e) {
      console.error('[BUYER-PORTAL] Owner notification failed:', e.message);
    }

    // Add system message to order thread
    try {
      const totalQty = items.reduce((s, i) => s + Number(i.quantity || 0), 0);
      await sendMessage(order.id, 'owner', `Order placed via buyer portal. ${totalQty} pieces across ${items.length} item(s).`, {
        senderId: 'system',
      });
    } catch (e) {
      console.error('[BUYER-PORTAL] System message failed:', e.message);
    }

    // Reload order to get updated suggested_deadline
    const finalOrder = await getOrderById(order.id);

    return success(res, {
      order_id: finalOrder.id,
      status: finalOrder.status,
      total_price: finalOrder.total_price,
      suggested_deadline: finalOrder.suggested_deadline,
      availability_result: result.material_status,
      message: 'Your order has been placed successfully. We will send you a quotation shortly.',
    }, 201);
  } catch (err) {
    return next(err);
  }
});

// GET /api/buyer-portal/orders
router.get('/orders', buyerAuth, async (req, res, next) => {
  try {
    const allOrders = await listOrders({ buyer_id: req.buyer.buyer_id });
    // Fallback: filter by buyer_id if listOrders doesn't support it
    const filtered = allOrders.filter(o => o.buyer_id === req.buyer.buyer_id);
    // Also check orders with matching buyer_name from the buyer profile
    const buyerRes = await pool.query('SELECT * FROM buyers WHERE id = $1::uuid', [req.buyer.buyer_id]);
    const buyerName = buyerRes.rows[0]?.name;
    const byName = buyerName ? allOrders.filter(o => o.buyer_name === buyerName && o.buyer_id !== req.buyer.buyer_id) : [];
    return success(res, [...filtered, ...byName]);
  } catch (err) {
    return next(err);
  }
});

// GET /api/buyer-portal/orders/:orderId
router.get('/orders/:orderId', buyerAuth, async (req, res, next) => {
  try {
    const order = await getOrderById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, error: 'order not found' });

    // Verify order belongs to this buyer
    const buyerRes = await pool.query('SELECT name FROM buyers WHERE id = $1::uuid', [req.buyer.buyer_id]);
    const buyerName = buyerRes.rows[0]?.name;
    if (order.buyer_id !== req.buyer.buyer_id && order.buyer_name !== buyerName) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    let priceBreakdown = null;
    try {
      priceBreakdown = await pricingEngine.calculateOrderPrice(req.params.orderId);
    } catch (e) {
      // pricing may fail for new orders — non-critical
    }

    return success(res, { ...order, price_breakdown: priceBreakdown });
  } catch (err) {
    return next(err);
  }
});

// GET /api/buyer-portal/orders/:orderId/messages
router.get('/orders/:orderId/messages', buyerAuth, async (req, res, next) => {
  try {
    const messages = await getMessages(req.params.orderId);
    await markMessagesRead(req.params.orderId, 'buyer');
    const unread = await getUnreadCount(req.params.orderId, 'buyer');
    return success(res, { messages, unread_count: unread });
  } catch (err) {
    return next(err);
  }
});

// POST /api/buyer-portal/orders/:orderId/messages/:messageId/respond — buyer accepts/rejects price proposal
router.post('/orders/:orderId/messages/:messageId/respond', buyerAuth, async (req, res, next) => {
  try {
    const { action, notes } = req.body || {};

    if (!action || !['accept', 'reject'].includes(action)) {
      return failure(res, 'action must be "accept" or "reject"');
    }

    // Verify order belongs to this buyer
    const order = await getOrderById(req.params.orderId);
    if (!order) return failure(res, 'Order not found', 404);
    const buyerRes = await pool.query('SELECT name FROM buyers WHERE id = $1::uuid', [req.buyer.buyer_id]);
    const buyerName = buyerRes.rows[0]?.name;
    if (order.buyer_id !== req.buyer.buyer_id && order.buyer_name !== buyerName) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const msgRes = await pool.query(
      "SELECT * FROM messages WHERE id = $1 AND order_id = $2 AND message_type = 'price_proposal'",
      [req.params.messageId, req.params.orderId]
    );
    if (msgRes.rowCount === 0) {
      return failure(res, 'Price proposal not found', 404);
    }
    const proposal = msgRes.rows[0];
    if (proposal.proposal_status !== 'pending') {
      return failure(res, 'This proposal has already been responded to');
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
      await sendMessage(req.params.orderId, 'buyer', `Price proposal accepted. New total: ₹${newTotal.toLocaleString('en-IN')}.`, {
        senderId: req.buyer.buyer_id,
      });

      // Fetch updated order with price_breakdown
      const updatedOrder = await getOrderById(req.params.orderId);
      let priceBreakdown = null;
      try {
        priceBreakdown = await pricingEngine.calculateOrderPrice(req.params.orderId, { item_margins: itemMargins });
      } catch (e) { /* non-critical */ }

      // Emit order_updated so dashboard refreshes in real time
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
      await sendMessage(req.params.orderId, 'buyer', `Price proposal rejected.${notes ? ' Reason: ' + notes : ''}`, {
        senderId: req.buyer.buyer_id,
      });

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

// POST /api/buyer-portal/orders/:orderId/messages
router.post('/orders/:orderId/messages', buyerAuth, async (req, res, next) => {
  try {
    const { body } = req.body || {};
    if (!body) return failure(res, 'body is required');
    const message = await sendMessage(req.params.orderId, 'buyer', body, {
      senderId: req.buyer.buyer_id,
    });
    return success(res, message, 201);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
