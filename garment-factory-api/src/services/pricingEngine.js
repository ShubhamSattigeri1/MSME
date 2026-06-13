const pool = require('../db');
const { assertUuid } = require('../utils/validation');

// minutes per garment lookup — keep here for easy editing
const MINUTES_PER_GARMENT = {
  default: 15,
  'formal shirt': 22,
  't-shirt': 10,
  kurta: 18,
  'denim jeans': 30,
  'kids frock': 12,
};

async function getPricingSettings() {
  const res = await pool.query('SELECT * FROM pricing_settings ORDER BY updated_at DESC LIMIT 1');
  return res.rows[0] || null;
}

/**
 * calculateOrderPrice(orderId, overrides = {})
 * overrides may include: wastage_pct, margin_pct, labour_cost_per_min, overhead_per_unit, minutes_per_garment, dbClient
 */
async function calculateOrderPrice(orderId, overrides = {}) {
  assertUuid(orderId, 'orderId');

  const client = overrides.dbClient || pool;

  const settings = await (overrides.dbClient ? client.query('SELECT * FROM pricing_settings ORDER BY updated_at DESC LIMIT 1').then(r => r.rows[0]) : getPricingSettings());
  if (!settings) throw new Error('Pricing settings not found');

  const wastage_pct = Number((overrides.wastage_pct !== undefined ? overrides.wastage_pct : settings.default_wastage_pct));
  const labour_cost_per_min = Number((overrides.labour_cost_per_min !== undefined ? overrides.labour_cost_per_min : settings.labour_cost_per_min));
  const overhead_per_unit = Number((overrides.overhead_per_unit !== undefined ? overrides.overhead_per_unit : settings.overhead_per_unit));
  const minimum_margin_pct = Number(settings.minimum_margin_pct || 0.05);

  const orderResult = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (orderResult.rowCount === 0) throw new Error('Order not found');
  const order = orderResult.rows[0];

  // Margin priority: 1) overrides.margin_pct, 2) order.negotiated_margin_pct, 3) settings.default_margin_pct
  let rawMargin;
  if (overrides.margin_pct !== undefined) {
    rawMargin = Number(overrides.margin_pct);
  } else if (order.negotiated_margin_pct !== null && order.negotiated_margin_pct !== undefined) {
    rawMargin = Number(order.negotiated_margin_pct);
  } else {
    rawMargin = Number(settings.default_margin_pct);
  }

  // Per-item margin overrides: { [order_item_id]: margin_pct }
  const itemMargins = overrides.item_margins || {};

  // Enforce floor
  const margin_pct = Math.max(rawMargin, minimum_margin_pct);
  let warning = null;
  if (rawMargin < minimum_margin_pct) {
    warning = `Margin floored at minimum: ${(minimum_margin_pct * 100).toFixed(1)}%`;
  }

  const itemsResult = await client.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
  if (itemsResult.rowCount === 0) throw new Error('Order has no items to price');

  const itemsOut = [];
  let order_total = 0;

  for (const item of itemsResult.rows) {
    const bomResult = await client.query(
      `SELECT b.qty_per_unit, m.unit_cost
       FROM bom b
       JOIN materials m ON m.id = b.material_id
       WHERE b.garment_type = $1`,
      [item.garment_type]
    );

    if (bomResult.rowCount === 0) {
      throw new Error(`No BOM entries for garment type: ${item.garment_type}`);
    }

    // material_cost is total for this order item (qty_per_unit * item.quantity * unit_cost)
    let material_cost = 0;
    for (const row of bomResult.rows) {
      material_cost += Number(row.qty_per_unit) * Number(item.quantity) * Number(row.unit_cost);
    }

    const minutes_per_garment = overrides.minutes_per_garment !== undefined
      ? Number(overrides.minutes_per_garment)
      : (MINUTES_PER_GARMENT[item.garment_type?.toLowerCase?.()] || MINUTES_PER_GARMENT.default);

    const wastage_cost = material_cost * wastage_pct;
    const labour_cost = minutes_per_garment * labour_cost_per_min * Number(item.quantity);
    const overhead_cost = overhead_per_unit * Number(item.quantity);
    const subtotal = material_cost + wastage_cost + labour_cost + overhead_cost;

    // Per-item margin override, fallback to order-level margin
    const itemRawMargin = itemMargins[item.id] !== undefined
      ? Number(itemMargins[item.id])
      : rawMargin;
    const itemMargin = Math.max(itemRawMargin, minimum_margin_pct);

    const margin_amount = subtotal * itemMargin;
    const item_total = subtotal + margin_amount;
    const unit_price = item_total / Number(item.quantity);

    // round values to 2 decimals before storing
    const material_cost_r = Number(material_cost.toFixed(2));
    const wastage_cost_r = Number(wastage_cost.toFixed(2));
    const labour_cost_r = Number(labour_cost.toFixed(2));
    const overhead_cost_r = Number(overhead_cost.toFixed(2));
    const margin_amount_r = Number(margin_amount.toFixed(2));
    const item_total_r = Number(item_total.toFixed(2));
    const unit_price_r = Number(unit_price.toFixed(2));

    // Persist unit_price to order_items table
    await client.query('UPDATE order_items SET unit_price = $1 WHERE id = $2', [unit_price_r, item.id]);

    itemsOut.push({
      order_item_id: item.id,
      garment_type: item.garment_type,
      quantity: Number(item.quantity),
      material_cost: material_cost_r,
      wastage_cost: wastage_cost_r,
      labour_cost: labour_cost_r,
      overhead_cost: overhead_cost_r,
      margin_pct: itemMargin,
      margin_amount: margin_amount_r,
      item_total: item_total_r,
      unit_price: unit_price_r,
    });

    order_total += item_total_r;
  }

  const order_total_r = Number(order_total.toFixed(2));

  // update orders.total_price in DB (use client if provided)
  await client.query('UPDATE orders SET total_price = $1, updated_at = NOW() WHERE id = $2', [order_total_r, orderId]);

  const result = {
    order_id: orderId,
    items: itemsOut,
    order_total: order_total_r,
    effective_margin_pct: margin_pct,
    parameters_used: {
      wastage_pct,
      margin_pct,
      labour_cost_per_min,
      overhead_per_unit,
    },
    calculated_at: new Date().toISOString(),
  };

  if (warning) result.warning = warning;

  return result;
}

module.exports = {
  calculateOrderPrice,
  MINUTES_PER_GARMENT,
};
