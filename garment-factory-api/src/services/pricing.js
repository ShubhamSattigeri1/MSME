const pool = require('../db');
const { assertNonNegativeNumber, assertPositiveNumber, assertUuid } = require('../utils/validation');

const DEFAULT_LABOUR_MINUTES_PER_UNIT = 12;

async function getPricingSettings(factoryId) {
  const values = [];
  let where = '';
  if (factoryId) {
    values.push(factoryId);
    where = 'WHERE factory_id = $1';
  }
  const result = await pool.query(`SELECT * FROM pricing_settings ${where} ORDER BY updated_at DESC LIMIT 1`, values);
  return result.rows[0] || null;
}

async function updatePricingSettings(payload) {
  // accept both names: wastage_pct/default_wastage_pct, margin_pct/default_margin_pct
  const labour = payload.labour_cost_per_min;
  const overhead = payload.overhead_per_unit;
  const wastage = payload.default_wastage_pct !== undefined ? payload.default_wastage_pct : payload.wastage_pct;
  const margin = payload.default_margin_pct !== undefined ? payload.default_margin_pct : payload.margin_pct;
  const minimumMargin = payload.minimum_margin_pct !== undefined ? payload.minimum_margin_pct : undefined;

  assertNonNegativeNumber(labour, 'labour_cost_per_min');
  assertNonNegativeNumber(overhead, 'overhead_per_unit');
  assertNonNegativeNumber(wastage, 'wastage_pct');
  assertNonNegativeNumber(margin, 'margin_pct');

  if (Number(wastage) < 0 || Number(wastage) > 1) throw new Error('wastage_pct must be between 0 and 1');
  if (Number(margin) < 0 || Number(margin) > 1) throw new Error('margin_pct must be between 0 and 1');

  if (minimumMargin !== undefined) {
    assertNonNegativeNumber(minimumMargin, 'minimum_margin_pct');
    if (Number(minimumMargin) < 0 || Number(minimumMargin) > 0.5) throw new Error('minimum_margin_pct must be between 0 and 0.5');
  }

  const current = await getPricingSettings(payload.factory_id);

  if (!current) {
    if (!payload.factory_id) throw new Error('factory_id is required');
    const insertResult = await pool.query(
      `INSERT INTO pricing_settings
         (factory_id, labour_cost_per_min, overhead_per_unit, default_wastage_pct, default_margin_pct, minimum_margin_pct)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        payload.factory_id,
        labour,
        overhead,
        wastage,
        margin,
        minimumMargin !== undefined ? minimumMargin : 0.05,
      ]
    );
    return insertResult.rows[0];
  }

  const fields = [];
  const values = [];
  let idx = 1;

  fields.push('labour_cost_per_min = $' + idx++);
  values.push(labour);
  fields.push('overhead_per_unit = $' + idx++);
  values.push(overhead);
  fields.push('default_wastage_pct = $' + idx++);
  values.push(wastage);
  fields.push('default_margin_pct = $' + idx++);
  values.push(margin);

  if (minimumMargin !== undefined) {
    fields.push('minimum_margin_pct = $' + idx++);
    values.push(minimumMargin);
  }

  values.push(current.id);
  fields.push('updated_at = NOW()');

  const updateResult = await pool.query(
    `UPDATE pricing_settings SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  return updateResult.rows[0];
}

async function calculateOrderPrice(orderId, options = {}) {
  assertUuid(orderId, 'order_id');

  if (options.labour_minutes_per_unit !== undefined) {
    assertPositiveNumber(options.labour_minutes_per_unit, 'labour_minutes_per_unit');
  }

  const settings = await getPricingSettings();
  if (!settings) {
    throw new Error('Pricing settings not found');
  }

  const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (orderResult.rowCount === 0) {
    throw new Error('Order not found');
  }

  const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
  if (itemsResult.rowCount === 0) {
    throw new Error('Order has no items to price');
  }

  const labourMinutesPerUnit = Number(options.labour_minutes_per_unit || DEFAULT_LABOUR_MINUTES_PER_UNIT);
  const wastagePct = Number(settings.default_wastage_pct);
  const marginPct = Number(settings.default_margin_pct);
  const labourCostPerMin = Number(settings.labour_cost_per_min);
  const overheadPerUnit = Number(settings.overhead_per_unit);
  const breakdown = [];
  let totalPrice = 0;

  for (const item of itemsResult.rows) {
    const bomResult = await pool.query(
      `SELECT b.qty_per_unit, m.unit_cost
       FROM bom b
       JOIN materials m ON m.id = b.material_id
       WHERE b.garment_type = $1`,
      [item.garment_type]
    );

    if (bomResult.rowCount === 0) {
      throw new Error(`No BOM entries found for garment type: ${item.garment_type}`);
    }

    const materialCostPerUnit = bomResult.rows.reduce(
      (sum, row) => sum + Number(row.qty_per_unit) * Number(row.unit_cost),
      0
    );
    const wastedMaterialCost = materialCostPerUnit * (1 + wastagePct);
    const labourCost = labourMinutesPerUnit * labourCostPerMin;
    const baseUnitCost = wastedMaterialCost + labourCost + overheadPerUnit;
    const unitPrice = baseUnitCost * (1 + marginPct);
    const lineTotal = unitPrice * Number(item.quantity);

    breakdown.push({
      order_item_id: item.id,
      garment_type: item.garment_type,
      quantity: item.quantity,
      material_cost_per_unit: Number(materialCostPerUnit.toFixed(2)),
      labour_cost_per_unit: Number(labourCost.toFixed(2)),
      overhead_per_unit: Number(overheadPerUnit.toFixed(2)),
      unit_price: Number(unitPrice.toFixed(2)),
      line_total: Number(lineTotal.toFixed(2)),
    });

    totalPrice += lineTotal;
  }

  return {
    order_id: orderId,
    currency: 'INR',
    total_price: Number(totalPrice.toFixed(2)),
    settings,
    labour_minutes_per_unit: labourMinutesPerUnit,
    breakdown,
  };
}

module.exports = {
  DEFAULT_LABOUR_MINUTES_PER_UNIT,
  getPricingSettings,
  updatePricingSettings,
  calculateOrderPrice,
};
