const pool = require('../db');
const { assertUuid } = require('../utils/validation');
const { calculateOrderPrice } = require('./pricingEngine');
const { generateQuotation } = require('./quotationGenerator');

async function applyNegotiatedMargin(orderId, newMarginPct, notes, factoryId) {
  assertUuid(orderId, 'orderId');

  if (typeof newMarginPct !== 'number' || isNaN(newMarginPct)) {
    throw new Error('margin_pct must be a number');
  }
  if (newMarginPct < 0 || newMarginPct > 1) {
    throw new Error('margin_pct must be between 0 and 1');
  }

  const settingsRes = await pool.query('SELECT * FROM pricing_settings WHERE factory_id = $1 ORDER BY updated_at DESC LIMIT 1', [factoryId]);
  const settings = settingsRes.rows[0];
  if (!settings) throw new Error('Pricing settings not found');

  const minimum_margin_pct = Number(settings.minimum_margin_pct || 0.05);
  if (newMarginPct < minimum_margin_pct) {
    throw new Error(
      `Margin cannot go below minimum floor of ${(minimum_margin_pct * 100).toFixed(1)}%. Current request: ${(newMarginPct * 100).toFixed(1)}%`
    );
  }

  const orderRes = await pool.query(factoryId ? 'SELECT * FROM orders WHERE id = $1::uuid AND factory_id = $2' : 'SELECT * FROM orders WHERE id = $1::uuid', factoryId ? [orderId, factoryId] : [orderId]);
  if (orderRes.rowCount === 0) throw new Error('Order not found or access denied');
  const order = orderRes.rows[0];

  const previousMargin = order.negotiated_margin_pct != null
    ? Number(order.negotiated_margin_pct)
    : Number(settings.default_margin_pct);

  const historyEntry = {
    timestamp: new Date().toISOString(),
    previous_margin: previousMargin,
    new_margin: newMarginPct,
    notes: notes || null,
  };

  const existingHistory = order.negotiation_history || [];
  const updatedHistory = [...existingHistory, historyEntry];

  await pool.query(
    `UPDATE orders SET
       negotiated_margin_pct = $1::numeric,
       negotiation_notes = $2,
       negotiation_history = $3::jsonb,
       updated_at = NOW()
     WHERE id = $4::uuid AND factory_id = $5`,
    [newMarginPct, notes || null, JSON.stringify(updatedHistory), orderId, factoryId]
  );

  const price = await calculateOrderPrice(orderId, { margin_pct: newMarginPct, factoryId });
  const quotation = await generateQuotation(orderId, factoryId);

  const warning = newMarginPct < minimum_margin_pct
    ? `Margin floored at minimum: ${(minimum_margin_pct * 100).toFixed(1)}%`
    : null;

  return {
    order_id: orderId,
    new_margin_pct: newMarginPct,
    new_total_price: price.order_total,
    effective_margin_pct: price.effective_margin_pct,
    new_quotation: quotation,
    warning,
  };
}

async function getNegotiationHistory(orderId, factoryId) {
  assertUuid(orderId, 'orderId');
  const res = await pool.query(factoryId ? 'SELECT negotiation_history FROM orders WHERE id = $1::uuid AND factory_id = $2' : 'SELECT negotiation_history FROM orders WHERE id = $1::uuid', factoryId ? [orderId, factoryId] : [orderId]);
  if (res.rowCount === 0) throw new Error('Order not found or access denied');
  return res.rows[0].negotiation_history || [];
}

async function resetMargin(orderId, factoryId) {
  assertUuid(orderId, 'orderId');

  const orderRes = await pool.query(factoryId ? 'SELECT * FROM orders WHERE id = $1::uuid AND factory_id = $2' : 'SELECT * FROM orders WHERE id = $1::uuid', factoryId ? [orderId, factoryId] : [orderId]);
  if (orderRes.rowCount === 0) throw new Error('Order not found or access denied');
  const order = orderRes.rows[0];

  if (order.negotiated_margin_pct == null) {
    throw new Error('Order already uses default margin');
  }

  await pool.query(
    `UPDATE orders SET
       negotiated_margin_pct = NULL,
       negotiation_notes = NULL,
       updated_at = NOW()
     WHERE id = $1::uuid AND factory_id = $2`,
    [orderId, factoryId]
  );

  const price = await calculateOrderPrice(orderId);
  await generateQuotation(orderId, factoryId);

  return {
    order_id: orderId,
    total_price: price.order_total,
    effective_margin_pct: price.effective_margin_pct,
  };
}

module.exports = {
  applyNegotiatedMargin,
  getNegotiationHistory,
  resetMargin,
};
