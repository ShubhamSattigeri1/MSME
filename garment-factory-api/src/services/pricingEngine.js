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
  const margin_pct = Number((overrides.margin_pct !== undefined ? overrides.margin_pct : settings.default_margin_pct));
  const labour_cost_per_min = Number((overrides.labour_cost_per_min !== undefined ? overrides.labour_cost_per_min : settings.labour_cost_per_min));
  const overhead_per_unit = Number((overrides.overhead_per_unit !== undefined ? overrides.overhead_per_unit : settings.overhead_per_unit));

  const orderResult = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (orderResult.rowCount === 0) throw new Error('Order not found');

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
    const margin_amount = subtotal * margin_pct;
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

    itemsOut.push({
      order_item_id: item.id,
      garment_type: item.garment_type,
      quantity: Number(item.quantity),
      material_cost: material_cost_r,
      wastage_cost: wastage_cost_r,
      labour_cost: labour_cost_r,
      overhead_cost: overhead_cost_r,
      margin_amount: margin_amount_r,
      item_total: item_total_r,
      unit_price: unit_price_r,
    });

    order_total += item_total_r;
  }

  const order_total_r = Number(order_total.toFixed(2));

  // update orders.total_price in DB (use client if provided)
  await client.query('UPDATE orders SET total_price = $1, updated_at = NOW() WHERE id = $2', [order_total_r, orderId]);

  return {
    order_id: orderId,
    items: itemsOut,
    order_total: order_total_r,
    parameters_used: {
      wastage_pct,
      margin_pct,
      labour_cost_per_min,
      overhead_per_unit,
    },
    calculated_at: new Date().toISOString(),
  };
}

module.exports = {
  calculateOrderPrice,
  MINUTES_PER_GARMENT,
};
