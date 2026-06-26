const express = require('express');
const { listBuyers, getBuyerById, createBuyer, updateBuyer, getBuyerOrders } = require('../services/buyers');
const { sendMessage } = require('../services/messaging');
const pool = require('../db');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

router.get('/', async (req, res, next) => {
  try {
    return success(res, await listBuyers({ ...req.query, factory_id: req.factoryId }));
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    return success(res, await createBuyer({ ...req.body, factory_id: req.factoryId }), 201);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const buyer = await getBuyerById(req.params.id, req.factoryId);
    if (!buyer) return res.status(404).json({ success: false, error: 'buyer not found' });
    return success(res, buyer);
  } catch (err) {
    return next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const buyer = await updateBuyer(req.params.id, req.body, req.factoryId);
    if (!buyer) return res.status(404).json({ success: false, error: 'buyer not found' });
    return success(res, buyer);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id/orders', async (req, res, next) => {
  try {
    return success(res, await getBuyerOrders(req.params.id, req.factoryId));
  } catch (err) {
    return next(err);
  }
});

// GET /api/buyers/:id/messages — all messages across buyer's orders
router.get('/:id/messages', async (req, res, next) => {
  try {
    const buyerId = req.params.id;
    // Verify buyer belongs to this factory
    const buyerCheck = await pool.query('SELECT id FROM buyers WHERE id = $1::uuid AND factory_id = $2::uuid', [buyerId, req.factoryId]);
    if (buyerCheck.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'buyer not found' });
    }
    const result = await pool.query(
      `SELECT m.*, o.buyer_name
       FROM messages m
       JOIN orders o ON o.id = m.order_id
       WHERE o.buyer_id = $1::uuid AND o.factory_id = $2::uuid
       ORDER BY m.created_at ASC`,
      [buyerId, req.factoryId]
    );
    const messages = result.rows;
    // Mark buyer messages as read
    for (const msg of messages) {
      if (msg.sender_type === 'buyer' && !msg.read_at) {
        await pool.query('UPDATE messages SET read_at = NOW() WHERE id = $1', [msg.id]);
      }
    }
    return success(res, messages);
  } catch (err) {
    return next(err);
  }
});

// POST /api/buyers/:id/messages — send message to buyer (requires order_id)
router.post('/:id/messages', async (req, res, next) => {
  try {
    const buyerId = req.params.id;
    const { body, order_id } = req.body || {};
    if (!body) return res.status(400).json({ success: false, error: 'body is required' });
    if (!order_id) return res.status(400).json({ success: false, error: 'order_id is required' });

    // Verify order belongs to buyer AND factory
    const orderCheck = await pool.query('SELECT id FROM orders WHERE id = $1::uuid AND buyer_id = $2::uuid AND factory_id = $3::uuid', [order_id, buyerId, req.factoryId]);
    if (orderCheck.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'order not found for this buyer' });
    }

    const message = await sendMessage(order_id, 'owner', body, { senderId: 'owner', factoryId: req.factoryId });
    return success(res, message, 201);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;