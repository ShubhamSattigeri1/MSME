const pool = require('../db');
const { assertUuid } = require('../utils/validation');
const { resolveTemplate } = require('../config/messageTemplates');

async function sendMessage(orderId, senderType, body, options = {}) {
  assertUuid(orderId, 'orderId');

  const { templateKey, senderId, factoryId } = options;
  let messageBody = body;

  if (factoryId) {
    // Verify order belongs to factory when factoryId provided
    const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1 AND factory_id = $2', [orderId, factoryId]);
    if (orderRes.rowCount === 0) {
      throw new Error('Order not found or access denied');
    }
  }

  if (templateKey && templateKey !== 'custom') {
    const orderRes = await pool.query(factoryId ? 'SELECT * FROM orders WHERE id = $1 AND factory_id = $2' : 'SELECT * FROM orders WHERE id = $1', factoryId ? [orderId, factoryId] : [orderId]);
    const order = orderRes.rows[0] || {};
    const items = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
    const totalQty = items.rows.reduce((s, i) => s + Number(i.quantity || 0), 0);
    const total = order.total_price ? Number(order.total_price).toFixed(2) : 'N/A';

    messageBody = resolveTemplate(templateKey, {
      buyer_name: order.buyer_name || 'Customer',
      order_id_short: (order.id || '').slice(0, 8).toUpperCase(),
      total_qty: totalQty,
      grand_total: total,
      expected_completion: order.delivery_deadline ? String(order.delivery_deadline).slice(0, 10) : 'N/A',
      confirm_by_date: order.delivery_deadline ? String(order.delivery_deadline).slice(0, 10) : 'N/A',
      quotation_number: '',
      valid_until: '',
    });
  }

  const result = await pool.query(
    `INSERT INTO messages (order_id, sender_type, sender_id, body, is_template, template_key)
     VALUES ($1::uuid, $2, $3, $4, $5, $6)
     RETURNING *`,
    [orderId, senderType, senderId || null, messageBody, !!templateKey, templateKey || null]
  );

  const message = result.rows[0];

  // Emit real-time event via WebSocket
  try {
    const { getIO } = require('../socket');
    const io = getIO();
    if (io) {
      io.to(`order_${orderId}`).emit('new_message', message);
    }
  } catch (e) { /* non-critical */ }

  // If owner sent a message and order has buyer email, also try email
  if (senderType === 'owner') {
    try {
      const orderRes = await pool.query(factoryId ? 'SELECT * FROM orders WHERE id = $1 AND factory_id = $2' : 'SELECT * FROM orders WHERE id = $1', factoryId ? [orderId, factoryId] : [orderId]);
      const order = orderRes.rows[0];
      const contact = order?.buyer_contact;
      if (contact && contact.includes('@')) {
        const notifier = require('./notifier');
        // Use internal sendMail through notifier's mechanism
        const nodemailer = require('nodemailer');
        const host = process.env.SMTP_HOST;
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;
        if (host && user && pass) {
          const transporter = nodemailer.createTransport({
            host, port: Number(process.env.SMTP_PORT) || 587,
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: { user, pass },
          });
          const from = process.env.SMTP_FROM || user;
          await transporter.sendMail({
            from: `"${process.env.FACTORY_NAME || 'Garment Factory'}" <${from}>`,
            to: contact,
            subject: `New message regarding order #${(order.id || '').slice(0, 8).toUpperCase()}`,
            text: messageBody,
          });
        }
      }
    } catch (e) {
      console.error('[MESSAGING] Failed to send email notification:', e.message);
    }
  }

  return message;
}

async function getMessages(orderId, factoryId = null) {
  assertUuid(orderId, 'orderId');
  
  let query = 'SELECT * FROM messages WHERE order_id = $1::uuid';
  const values = [orderId];
  
  if (factoryId) {
    query += ' AND EXISTS (SELECT 1 FROM orders WHERE id = messages.order_id AND factory_id = $2)';
    values.push(factoryId);
  }
  
  query += ' ORDER BY created_at ASC';
  
  const result = await pool.query(query, values);
  return result.rows;
}

async function markMessagesRead(orderId, readerType, factoryId = null) {
  assertUuid(orderId, 'orderId');
  
  let query = `UPDATE messages SET read_at = NOW() WHERE order_id = $1::uuid AND sender_type != $2 AND read_at IS NULL`;
  const values = [orderId, readerType];
  
  if (factoryId) {
    query += ` AND EXISTS (SELECT 1 FROM orders WHERE id = messages.order_id AND factory_id = $3)`;
    values.push(factoryId);
  }
  
  query += ` RETURNING id`;
  
  const result = await pool.query(query, values);
  return result.rowCount;
}

async function getUnreadCount(orderId, readerType, factoryId = null) {
  assertUuid(orderId, 'orderId');
  
  let query = `SELECT COUNT(*) AS count FROM messages WHERE order_id = $1::uuid AND sender_type != $2 AND read_at IS NULL`;
  const values = [orderId, readerType];
  
  if (factoryId) {
    query += ` AND EXISTS (SELECT 1 FROM orders WHERE id = messages.order_id AND factory_id = $3)`;
    values.push(factoryId);
  }
  
  const result = await pool.query(query, values);
  return parseInt(result.rows[0].count, 10);
}

module.exports = { sendMessage, getMessages, markMessagesRead, getUnreadCount };
