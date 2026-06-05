const pool = require('../db');
const { assertUuid } = require('../utils/validation');

function pad(num, size) {
  let s = String(num);
  while (s.length < size) s = '0' + s;
  return s;
}

async function generateQuotation(orderId) {
  assertUuid(orderId, 'orderId');

  const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (orderRes.rowCount === 0) throw new Error('Order not found');
  const order = orderRes.rows[0];

  const itemsRes = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);

  // generate sequence for year
  const year = new Date().getFullYear();
  const seqRes = await pool.query(`SELECT COUNT(*)::int AS cnt FROM quotations WHERE EXTRACT(YEAR FROM created_at) = $1`, [year]);
  const sequence = pad(seqRes.rows[0].cnt + 1, 4);
  const quotation_number = `QT-${year}-${sequence}`;

  const items = [];
  let subtotal = 0;

  for (const item of itemsRes.rows) {
    const unit_price = item.unit_price ? Number(item.unit_price) : 0;
    const item_total = Number((unit_price * Number(item.quantity)).toFixed(2));
    items.push({
      garment_type: item.garment_type,
      fabric_type: item.fabric_type,
      colour: item.colour,
      quantity: Number(item.quantity),
      size_breakdown: item.size_breakdown || null,
      unit_price: unit_price,
      item_total,
    });
    subtotal += item_total;
  }

  subtotal = Number(subtotal.toFixed(2));
  const gst_rate = Number(process.env.GST_RATE || 0.18);
  const tax_amount = Number((subtotal * gst_rate).toFixed(2));
  const grand_total = Number((subtotal + tax_amount).toFixed(2));

  const quotation = {
    quotation_number,
    factory_name: process.env.FACTORY_NAME || null,
    factory_contact: process.env.FACTORY_CONTACT || null,
    generated_at: new Date().toISOString(),
    valid_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    buyer_name: order.buyer_name,
    buyer_contact: order.buyer_contact || null,
    delivery_deadline: order.delivery_deadline || null,
    items,
    subtotal,
    tax_amount,
    grand_total,
    payment_terms: process.env.PAYMENT_TERMS || '50% advance, 50% on delivery',
    notes: 'Prices valid for 7 days. Subject to material availability.',
  };

  const insertRes = await pool.query(
    `INSERT INTO quotations (order_id, quotation_number, data, sent_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [orderId, quotation_number, quotation, null]
  );

  return insertRes.rows[0];
}

async function getLastQuotation(orderId) {
  assertUuid(orderId, 'orderId');
  const res = await pool.query('SELECT * FROM quotations WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1', [orderId]);
  return res.rows[0] || null;
}

module.exports = {
  generateQuotation,
  getLastQuotation,
};
