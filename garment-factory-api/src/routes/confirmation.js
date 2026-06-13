const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const buyerAuth = require('../middleware/buyerAuth');
const { sendMessage } = require('../services/messaging');
const { scheduleOrder } = require('../services/productionScheduler');
const notifier = require('../services/notifier');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function failure(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

// GET /api/confirm/:token — validate token and return order summary (public)
router.get('/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const tokRes = await pool.query(
      'SELECT * FROM confirmation_tokens WHERE token = $1',
      [token]
    );
    if (tokRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Invalid or expired link' });
    }

    const ct = tokRes.rows[0];

    if (ct.used_at) {
      return res.status(400).json({ success: false, error: 'This link has already been used' });
    }

    if (new Date(ct.expires_at) < new Date()) {
      return res.status(400).json({ success: false, error: 'This link has expired' });
    }

    const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [ct.order_id]);
    if (orderRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const order = orderRes.rows[0];
    const itemsRes = await pool.query('SELECT garment_type, quantity FROM order_items WHERE order_id = $1 ORDER BY id', [order.id]);
    const itemsSummary = itemsRes.rows.map(i => `${i.garment_type} x${i.quantity}`).join(', ');

    return success(res, {
      order_id: order.id,
      buyer_name: order.buyer_name,
      buyer_id: order.buyer_id,
      items_summary: itemsSummary,
      grand_total: Number(order.total_price || 0),
      action: ct.action,
      requires_account: true,
      status: order.status,
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/confirm/:token — buyer confirms or rejects (requires auth)
router.post('/:token', buyerAuth, async (req, res, next) => {
  try {
    const { token } = req.params;
    const tokRes = await pool.query(
      'SELECT * FROM confirmation_tokens WHERE token = $1',
      [token]
    );
    if (tokRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Invalid or expired link' });
    }

    const ct = tokRes.rows[0];

    if (ct.used_at) {
      return res.status(400).json({ success: false, error: 'This link has already been used' });
    }

    if (new Date(ct.expires_at) < new Date()) {
      return res.status(400).json({ success: false, error: 'This link has expired' });
    }

    const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [ct.order_id]);
    if (orderRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const order = orderRes.rows[0];

    if (order.buyer_id !== req.buyer.buyer_id) {
      return res.status(403).json({ success: false, error: 'This order does not belong to your account' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'UPDATE confirmation_tokens SET used_at = NOW() WHERE id = $1::uuid',
        [ct.id]
      );

      let newStatus;
      if (ct.action === 'confirm') {
        newStatus = 'confirmed';
        await client.query(
          "UPDATE orders SET status = 'confirmed', updated_at = NOW() WHERE id = $1::uuid",
          [ct.order_id]
        );

        await client.query('COMMIT');
        client.release();

        try {
          await scheduleOrder(ct.order_id);
        } catch (scheduleErr) {
          console.error('[CONFIRM] scheduleOrder error:', scheduleErr.message);
        }

        try {
          const scheduleRes = await pool.query('SELECT * FROM production_schedule WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1', [ct.order_id]);
          await notifier.sendProductionStarted(order, scheduleRes.rows[0] || {});
        } catch (notifyErr) {
          console.error('[CONFIRM] sendProductionStarted error:', notifyErr.message);
        }

        try {
          await sendMessage(ct.order_id, 'owner', `Buyer confirmed the order on ${new Date().toISOString().split('T')[0]}`, {
            senderId: 'system',
          });
        } catch (msgErr) {
          console.error('[CONFIRM] system message error:', msgErr.message);
        }
      } else {
        newStatus = 'cancelled';
        await client.query(
          "UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1::uuid",
          [ct.order_id]
        );

        await client.query('COMMIT');
        client.release();

        try {
          await sendMessage(ct.order_id, 'owner', `Buyer requested changes on ${new Date().toISOString().split('T')[0]}`, {
            senderId: 'system',
          });
        } catch (msgErr) {
          console.error('[CONFIRM] system message error:', msgErr.message);
        }
      }

      return success(res, {
        success: true,
        action: ct.action,
        order_id: ct.order_id,
        new_status: newStatus,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
  } catch (err) {
    return next(err);
  }
});

// GET /api/confirm/admin/:orderId — get confirmation status for order (owner)
router.get('/admin/:orderId', async (req, res, next) => {
  try {
    const tokRes = await pool.query(
      'SELECT * FROM confirmation_tokens WHERE order_id = $1::uuid ORDER BY created_at DESC',
      [req.params.orderId]
    );
    const tokens = tokRes.rows;
    const sent = tokens.length > 0;
    const usedToken = tokens.find(t => t.used_at);
    const expired = tokens.some(t => !t.used_at && new Date(t.expires_at) < new Date());
    const pending = tokens.some(t => !t.used_at && new Date(t.expires_at) >= new Date());
    const confirmToken = tokens.find(t => t.action === 'confirm');
    const rejectToken = tokens.find(t => t.action === 'reject');

    return success(res, {
      sent,
      used: !!usedToken,
      used_action: usedToken?.action || null,
      used_at: usedToken?.used_at || null,
      expired,
      pending,
      confirm_url: null,
      reject_url: null,
      token_count: tokens.length,
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/confirm/admin/:orderId/resend — regenerate tokens & resend email
router.post('/admin/:orderId/resend', async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1::uuid', [orderId]);
    if (orderRes.rowCount === 0) return res.status(404).json({ success: false, error: 'Order not found' });

    const quotationRes = await pool.query(
      'SELECT * FROM quotations WHERE order_id = $1::uuid ORDER BY created_at DESC LIMIT 1',
      [orderId]
    );
    if (quotationRes.rowCount === 0) return res.status(404).json({ success: false, error: 'No quotation found for this order' });

    const order = orderRes.rows[0];
    const quotation = quotationRes.rows[0];
    const qData = quotation.data || {};

    const buyerPortalUrl = (process.env.BUYER_PORTAL_URL || 'http://localhost:3002').replace(/\/+$/, '');
    const confirmToken = crypto.randomBytes(32).toString('hex');
    const rejectToken = crypto.randomBytes(32).toString('hex');
    const confirmUrl = `${buyerPortalUrl}/confirm?token=${confirmToken}`;
    const rejectUrl = `${buyerPortalUrl}/confirm?token=${rejectToken}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO confirmation_tokens (order_id, token, action, expires_at) VALUES ($1::uuid, $2, 'confirm', $3)`,
        [orderId, confirmToken, expiresAt]
      );
      await client.query(
        `INSERT INTO confirmation_tokens (order_id, token, action, expires_at) VALUES ($1::uuid, $2, 'reject', $3)`,
        [orderId, rejectToken, expiresAt]
      );

      qData.confirm_url = confirmUrl;
      qData.reject_url = rejectUrl;
      await client.query(
        'UPDATE quotations SET data = $1::jsonb, sent_at = NOW() WHERE id = $2::uuid',
        [qData, quotation.id]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    try {
      const updatedQuotation = { ...quotation, data: qData };
      await notifier.sendQuotationReady(order, updatedQuotation);
    } catch (notifyErr) {
      console.error('[CONFIRM] Resend email error:', notifyErr.message);
    }

    return success(res, { confirm_url: confirmUrl, reject_url: rejectUrl, sent: true });
  } catch (err) {
    return next(err);
  }
});

// POST /api/confirm/admin/:orderId/manual-confirm — owner confirms on buyer's behalf
router.post('/admin/:orderId/manual-confirm', async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1::uuid', [orderId]);
    if (orderRes.rowCount === 0) return res.status(404).json({ success: false, error: 'Order not found' });

    const order = orderRes.rows[0];
    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Order is already ${order.status}` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        "UPDATE orders SET status = 'confirmed', updated_at = NOW() WHERE id = $1::uuid",
        [orderId]
      );

      await client.query(
        "UPDATE confirmation_tokens SET used_at = NOW() WHERE order_id = $1::uuid AND used_at IS NULL",
        [orderId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    try {
      await scheduleOrder(orderId);
    } catch (scheduleErr) {
      console.error('[CONFIRM] scheduleOrder error:', scheduleErr.message);
    }

    try {
      await sendMessage(orderId, 'owner', `Order manually confirmed by factory on ${new Date().toISOString().split('T')[0]}`, {
        senderId: 'system',
      });
    } catch (msgErr) {
      console.error('[CONFIRM] system message error:', msgErr.message);
    }

    return success(res, { success: true, action: 'confirm', order_id: orderId, new_status: 'confirmed' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
