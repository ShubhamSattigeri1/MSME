const pool = require('../db');
const crypto = require('crypto');
const { assertRequired, assertUuid } = require('../utils/validation');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function findOrCreateBuyer(contact, factoryId) {
  const { name, email, phone } = contact || {};
  assertRequired(factoryId, 'factory_id');

  if (email) {
    const existing = await pool.query('SELECT * FROM buyers WHERE email = $1 AND factory_id = $2', [email, factoryId]);
    if (existing.rowCount > 0) return existing.rows[0];
  }

  if (phone) {
    const existing = await pool.query('SELECT * FROM buyers WHERE phone = $1 AND factory_id = $2', [phone, factoryId]);
    if (existing.rowCount > 0) return existing.rows[0];
  }

  const result = await pool.query(
    `INSERT INTO buyers (name, email, phone, factory_id) VALUES ($1, $2, $3, $4) RETURNING *`,
    [name || 'Unknown', email || null, phone || null, factoryId]
  );

  return result.rows[0];
}

async function listBuyers(filters = {}) {
  const { factory_id, search } = filters;
  assertRequired(factory_id, 'factory_id');

  const values = [factory_id];
  const clauses = ['b.factory_id = $1'];

  if (search) {
    values.push(`%${search}%`);
    clauses.push(`(b.name ILIKE $${values.length} OR b.email ILIKE $${values.length} OR b.company_name ILIKE $${values.length})`);
  }

  const whereClause = `WHERE ${clauses.join(' AND ')}`;

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

async function getBuyerById(id, factoryId) {
  assertUuid(id, 'id');
  assertRequired(factoryId, 'factory_id');

  const buyerResult = await pool.query('SELECT * FROM buyers WHERE id = $1 AND factory_id = $2', [id, factoryId]);
  if (buyerResult.rowCount === 0) return null;

  const ordersResult = await pool.query(
    'SELECT id, status, total_price, created_at FROM orders WHERE buyer_id = $1 ORDER BY created_at DESC',
    [id]
  );

  return { ...buyerResult.rows[0], orders: ordersResult.rows };
}

async function createBuyer(data) {
  const { name, email, phone, company_name, address, notes, factory_id } = data || {};
  assertRequired(name, 'name');
  assertRequired(factory_id, 'factory_id');

  if (email && !EMAIL_REGEX.test(email)) {
    throw new Error('Invalid email format');
  }

  const result = await pool.query(
    `INSERT INTO buyers (name, email, phone, company_name, address, notes, factory_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [name, email || null, phone || null, company_name || null, address || null, notes || null, factory_id]
  );

  return result.rows[0];
}

async function updateBuyer(id, data, factoryId) {
  assertUuid(id, 'id');
  assertRequired(factoryId, 'factory_id');

  if (data.email && !EMAIL_REGEX.test(data.email)) {
    throw new Error('Invalid email format');
  }

  const fields = [];
  const values = [factoryId];
  let idx = 2;

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
  const result = await pool.query(
    `UPDATE buyers SET ${fields.join(', ')}, updated_at = NOW() WHERE factory_id = $1 AND id = $${idx}::uuid RETURNING *`,
    values
  );

  return result.rows[0] || null;
}

async function getBuyerOrders(buyerId, factoryId) {
  assertUuid(buyerId, 'buyerId');
  assertRequired(factoryId, 'factory_id');

  const buyerCheck = await pool.query('SELECT id FROM buyers WHERE id = $1 AND factory_id = $2', [buyerId, factoryId]);
  if (buyerCheck.rowCount === 0) {
    return [];
  }

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