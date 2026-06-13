const pool = require('../db');
const crypto = require('crypto');
const { assertRequired, assertUuid } = require('../utils/validation');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function findOrCreateBuyer(contact) {
  const { name, email, phone } = contact || {};

  if (email) {
    const existing = await pool.query('SELECT * FROM buyers WHERE email = $1', [email]);
    if (existing.rowCount > 0) return existing.rows[0];
  }

  if (phone) {
    const existing = await pool.query('SELECT * FROM buyers WHERE phone = $1', [phone]);
    if (existing.rowCount > 0) return existing.rows[0];
  }

  const result = await pool.query(
    `INSERT INTO buyers (name, email, phone) VALUES ($1, $2, $3) RETURNING *`,
    [name || 'Unknown', email || null, phone || null]
  );

  return result.rows[0];
}

async function listBuyers(filters = {}) {
  const values = [];
  const clauses = [];

  if (filters.search) {
    values.push(`%${filters.search}%`);
    clauses.push(`(b.name ILIKE $${values.length} OR b.email ILIKE $${values.length} OR b.company_name ILIKE $${values.length})`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT
       b.*,
       COUNT(DISTINCT o.id) AS order_count,
       COALESCE(SUM(DISTINCT o.total_price) FILTER (WHERE o.id IS NOT NULL), 0) AS total_order_value,
       COALESCE(ur.unread_count, 0) AS unread_count,
       lm.last_message_at
     FROM buyers b
     LEFT JOIN orders o ON o.buyer_id = b.id
     LEFT JOIN (
       SELECT o2.buyer_id, COUNT(*) AS unread_count
       FROM messages m
       JOIN orders o2 ON o2.id = m.order_id
       WHERE m.sender_type = 'buyer' AND m.read_at IS NULL
       GROUP BY o2.buyer_id
     ) ur ON ur.buyer_id = b.id
     LEFT JOIN (
       SELECT o3.buyer_id, MAX(m.created_at) AS last_message_at
       FROM messages m
       JOIN orders o3 ON o3.id = m.order_id
       WHERE m.sender_type = 'buyer'
       GROUP BY o3.buyer_id
     ) lm ON lm.buyer_id = b.id
     ${whereClause}
     GROUP BY b.id, ur.unread_count, lm.last_message_at
     ORDER BY
       CASE WHEN COALESCE(ur.unread_count, 0) > 0 THEN 0 ELSE 1 END,
       lm.last_message_at DESC NULLS LAST,
       b.created_at DESC`,
    values
  );

  return result.rows;
}

async function getBuyerById(id) {
  assertUuid(id, 'id');

  const buyerResult = await pool.query('SELECT * FROM buyers WHERE id = $1', [id]);
  if (buyerResult.rowCount === 0) return null;

  const ordersResult = await pool.query(
    'SELECT id, status, total_price, created_at FROM orders WHERE buyer_id = $1 ORDER BY created_at DESC',
    [id]
  );

  return { ...buyerResult.rows[0], orders: ordersResult.rows };
}

async function createBuyer(data) {
  const { name, email, phone, company_name, address, notes } = data || {};
  assertRequired(name, 'name');

  if (email && !EMAIL_REGEX.test(email)) {
    throw new Error('Invalid email format');
  }

  const result = await pool.query(
    `INSERT INTO buyers (name, email, phone, company_name, address, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [name, email || null, phone || null, company_name || null, address || null, notes || null]
  );

  return result.rows[0];
}

async function updateBuyer(id, data) {
  assertUuid(id, 'id');

  if (data.email && !EMAIL_REGEX.test(data.email)) {
    throw new Error('Invalid email format');
  }

  const fields = [];
  const values = [];
  let idx = 1;

  for (const key of ['name', 'email', 'phone', 'company_name', 'address', 'notes']) {
    if (data[key] !== undefined) {
      fields.push(`${key} = $${idx++}`);
      values.push(data[key]);
    }
  }

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(id);
  // Cast id to uuid to avoid pg type inference issues
  const result = await pool.query(
    `UPDATE buyers SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx}::uuid RETURNING *`,
    values
  );

  return result.rows[0] || null;
}

async function getBuyerOrders(buyerId) {
  assertUuid(buyerId, 'buyerId');

  const ordersResult = await pool.query(
    'SELECT * FROM orders WHERE buyer_id = $1 ORDER BY created_at DESC',
    [buyerId]
  );

  const orders = ordersResult.rows;

  for (const order of orders) {
    const itemsResult = await pool.query(
      'SELECT * FROM order_items WHERE order_id = $1 ORDER BY id',
      [order.id]
    );
    order.items = itemsResult.rows;
  }

  return orders;
}

module.exports = {
  findOrCreateBuyer,
  listBuyers,
  getBuyerById,
  createBuyer,
  updateBuyer,
  getBuyerOrders,
};
