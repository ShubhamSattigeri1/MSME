const pool = require('../db');
const { assertUuid } = require('../utils/validation');

const MINUTES_PER_GARMENT = {
  default: 15,
  'formal shirt': 22,
  't-shirt': 10,
  kurta: 18,
  'denim jeans': 30,
  'kids frock': 12,
};

const DEFAULT_PRICING = {
  labour_cost_per_min: 2.00,
  overhead_per_unit: 5.00,
  default_wastage_pct: 0.10,
  default_margin_pct: 0.20,
  minimum_margin_pct: 0.05,
};

async function getPricingSettings(factoryId) {
  let res = await pool.query('SELECT * FROM pricing_settings WHERE factory_id = $1 ORDER BY updated_at DESC LIMIT 1', [factoryId]);
  if (res.rowCount === 0) {
    res = await pool.query(
      `INSERT INTO pricing_settings (factory_id, labour_cost_per_min, overhead_per_unit, default_wastage_pct, default_margin_pct, minimum_margin_pct)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [factoryId, DEFAULT_PRICING.labour_cost_per_min, DEFAULT_PRICING.overhead_per_unit, DEFAULT_PRICING.default_wastage_pct, DEFAULT_PRICING.default_margin_pct, DEFAULT_PRICING.minimum_margin_pct]
    );
  }
  return res.rows[0];
}

async function calculateOrderPrice(orderId, overrides = {}) {
  assertUuid(orderId, 'orderId');

  const client = overrides.dbClient || pool;
  const factoryId = overrides.factoryId;
  if (!factoryId) throw new Error('factoryId is required');

  const settings = await (overrides.dbClient ? client.query('SELECT * FROM pricing_settings WHERE factory_id = $1 ORDER BY updated_at DESC LIMIT 1', [factoryId]).then(r => r.rows[0]) : getPricingSettings(factoryId));

  const wastage_pct = Number((overrides.wastage_pct !== undefined ? overrides.wastage_pct : settings.default_wastage_pct));
  const labour_cost_per_min = Number((overrides.labour_cost_per_min !== undefined ? overrides.labour_cost_per_min : settings.labour_cost_per_min));
  const overhead_per_unit = Number((overrides.overhead_per_unit !== undefined ? overrides.overhead_per_unit : settings.overhead_per_unit));
  const minimum_margin_pct = Number(settings.minimum_margin_pct || 0.05);

  const orderResult = await client.query('SELECT * FROM orders WHERE id = $1 AND factory_id = $2', [orderId, factoryId]);
  if (orderResult.rowCount === 0) throw new Error('Order not found');
  const order = orderResult.rows[0];

  let rawMargin;
  if (overrides.margin_pct !== undefined) {
    rawMargin = Number(overrides.margin_pct);
  } else if (order.negotiated_margin_pct !== null && order.negotiated_margin_pct !== undefined) {
    rawMargin = Number(order.negotiated_margin_pct);
  } else {
    rawMargin = Number(settings.default_margin_pct);
  }

  const itemMargins = overrides.item_margins || {};
  const margin_pct = Math.max(rawMargin, minimum_margin_pct);
  let warning = null;
  if (rawMargin < minimum_margin_pct) {
    warning = `Margin floored at minimum: ${(minimum_margin_pct * 100).toFixed(1)}%`;
  }

  const itemsResult = await client.query('SELECT * FROM order_items WHERE order_id = $1 AND factory_id = $2 ORDER BY id', [orderId, factoryId]);
  if (itemsResult.rowCount === 0) throw new Error('Order has no items to price');

  // Per-request cache for garment pricing configs (avoids N+1 for same garment_type)
  const garmentConfigCache = new Map();

  const itemsOut = [];
  let order_total = 0;

  for (const item of itemsResult.rows) {
    // Look up garment-specific pricing config (cached per request)
    const cacheKey = `${factoryId}::${item.garment_type}`;
    if (!garmentConfigCache.has(cacheKey)) {
      const configRes = await client.query(
        'SELECT * FROM garment_pricing_config WHERE factory_id = $1 AND garment_type = $2',
        [factoryId, item.garment_type]
      );
      garmentConfigCache.set(cacheKey, configRes.rows[0] || null);
    }
    const garmentConfig = garmentConfigCache.get(cacheKey);

    // Per-item effective values: garment config overrides global settings
    const itemWastagePct = garmentConfig?.wastage_pct != null ? Number(garmentConfig.wastage_pct) : wastage_pct;
    const itemLabourCostPerMin = garmentConfig?.labour_cost_per_min != null ? Number(garmentConfig.labour_cost_per_min) : labour_cost_per_min;
    const itemOverheadPerUnit = garmentConfig?.overhead_per_unit != null ? Number(garmentConfig.overhead_per_unit) : overhead_per_unit;
    const itemMinimumMarginPct = garmentConfig?.minimum_margin_pct != null ? Number(garmentConfig.minimum_margin_pct) : minimum_margin_pct;

    const bomResult = await client.query(
      `SELECT b.qty_per_unit, m.unit_cost
       FROM bom b
       JOIN materials m ON m.id = b.material_id
       WHERE LOWER(b.garment_type) = LOWER($1) AND b.factory_id = $2 AND m.factory_id = $2`,
      [item.garment_type, factoryId]
    );

    if (bomResult.rowCount === 0) {
      throw new Error(`No BOM entries for garment type: ${item.garment_type}`);
    }

    let material_cost = 0;
    for (const row of bomResult.rows) {
      material_cost += Number(row.qty_per_unit) * Number(item.quantity) * Number(row.unit_cost);
    }

    const minutes_per_garment = overrides.minutes_per_garment !== undefined
      ? Number(overrides.minutes_per_garment)
      : (MINUTES_PER_GARMENT[item.garment_type?.toLowerCase?.()] || MINUTES_PER_GARMENT.default);

    const wastage_cost = material_cost * itemWastagePct;
    const labour_cost = minutes_per_garment * itemLabourCostPerMin * Number(item.quantity);
    const overhead_cost = itemOverheadPerUnit * Number(item.quantity);
    const subtotal = material_cost + wastage_cost + labour_cost + overhead_cost;

    // Per-item margin: item margin override → garment config → order-level
    const itemDefaultMargin = garmentConfig?.margin_pct != null ? Number(garmentConfig.margin_pct) : rawMargin;
    const itemRawMargin = itemMargins[item.id] !== undefined
      ? Number(itemMargins[item.id])
      : itemDefaultMargin;
    const itemMargin = Math.max(itemRawMargin, itemMinimumMarginPct);

    const margin_amount = subtotal * itemMargin;
    const item_total = subtotal + margin_amount;
    const unit_price = item_total / Number(item.quantity);

    const material_cost_r = Number(material_cost.toFixed(2));
    const wastage_cost_r = Number(wastage_cost.toFixed(2));
    const labour_cost_r = Number(labour_cost.toFixed(2));
    const overhead_cost_r = Number(overhead_cost.toFixed(2));
    const margin_amount_r = Number(margin_amount.toFixed(2));
    const item_total_r = Number(item_total.toFixed(2));
    const unit_price_r = Number(unit_price.toFixed(2));

    await client.query('UPDATE order_items SET unit_price = $1 WHERE id = $2 AND factory_id = $3', [unit_price_r, item.id, factoryId]);

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
      garment_config_used: garmentConfig ? true : false,
    });

    order_total += item_total_r;
  }

  const order_total_r = Number(order_total.toFixed(2));

  await client.query('UPDATE orders SET total_price = $1, updated_at = NOW() WHERE id = $2 AND factory_id = $3', [order_total_r, orderId, factoryId]);

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
