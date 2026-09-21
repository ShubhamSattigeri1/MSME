const pool = require('../db');
const { assertNonNegativeNumber, assertPositiveNumber, assertRequired, assertUuid } = require('../utils/validation');

async function listMaterials(filters = {}) {
  const values = [];
  const conditions = [];

  if (filters.factory_id) {
    values.push(filters.factory_id);
    conditions.push(`factory_id = $${values.length}`);
  }

  if (filters.low_stock) {
    conditions.push('qty_available < reorder_threshold');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(`SELECT * FROM materials ${where} ORDER BY name`, values);
  return result.rows;
}

async function addMaterial(payload) {
  assertRequired(payload.factory_id, 'factory_id');
  assertRequired(payload.name, 'name');
  assertRequired(payload.unit, 'unit');
  assertNonNegativeNumber(payload.unit_cost, 'unit_cost');

  const result = await pool.query(
    `INSERT INTO materials
       (factory_id, name, category, unit, qty_available, unit_cost, supplier_name, reorder_threshold)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      payload.factory_id,
      payload.name,
      payload.category || null,
      payload.unit,
      payload.qty_available || 0,
      payload.unit_cost,
      payload.supplier_name || null,
      payload.reorder_threshold || 0,
    ]
  );

  return result.rows[0];
}

async function updateMaterial(id, updates) {
  assertUuid(id, 'id');

  if (updates.qty_available === undefined && updates.unit_cost === undefined && updates.supplier_lead_days === undefined) {
    throw new Error('qty_available, unit_cost, or supplier_lead_days is required');
  }

  const assignments = [];
  const values = [];

  if (updates.qty_available !== undefined) {
    assertNonNegativeNumber(updates.qty_available, 'qty_available');
    values.push(updates.qty_available);
    assignments.push(`qty_available = $${values.length}`);
  }

  if (updates.unit_cost !== undefined) {
    assertNonNegativeNumber(updates.unit_cost, 'unit_cost');
    values.push(updates.unit_cost);
    assignments.push(`unit_cost = $${values.length}`);
  }

  if (updates.supplier_lead_days !== undefined) {
    const days = Number(updates.supplier_lead_days);
    if (!Number.isInteger(days) || days < 0) throw new Error('supplier_lead_days must be a non-negative integer');
    values.push(days);
    assignments.push(`supplier_lead_days = $${values.length}`);
  }

  values.push(id);
  const result = await pool.query(
    `UPDATE materials
     SET ${assignments.join(', ')}, updated_at = NOW()
     WHERE id = $${values.length}
     RETURNING *`,
    values
  );

  return result.rows[0] || null;
}

async function checkAvailability(items, factoryId) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('items must contain at least one item');
  }

  const requirements = new Map();

  for (const item of items) {
    assertRequired(item.garment_type, 'garment_type');
    assertPositiveNumber(item.quantity, 'quantity');

    const bomResult = await pool.query(
      `SELECT
         b.material_id,
         b.qty_per_unit,
         m.name AS material_name,
         m.qty_available,
         m.unit
       FROM bom b
       JOIN materials m ON m.id = b.material_id
       WHERE LOWER(b.garment_type) = LOWER($1) AND b.factory_id = $2`,
      [item.garment_type, factoryId]
    );

    for (const row of bomResult.rows) {
      const requiredQty = Number(row.qty_per_unit) * Number(item.quantity);
      const existing = requirements.get(row.material_id) || {
        material_id: row.material_id,
        material_name: row.material_name,
        required: 0,
        available: Number(row.qty_available),
        unit: row.unit,
      };

      existing.required += requiredQty;
      requirements.set(row.material_id, existing);
    }
  }

  const shortfalls = Array.from(requirements.values())
    .filter((item) => item.required > item.available)
    .map((item) => ({
      material_id: item.material_id,
      material_name: item.material_name,
      required: Number(item.required.toFixed(4)),
      available: item.available,
      deficit: Number((item.required - item.available).toFixed(4)),
      unit: item.unit,
    }));

  return {
    sufficient: shortfalls.length === 0,
    shortfalls,
  };
}

async function getMaterialMovements(factoryId, limit = 50) {
  const result = await pool.query(
    `SELECT mml.*, o.buyer_name
     FROM material_movement_log mml
     JOIN orders o ON o.id = mml.order_id
     WHERE o.factory_id = $1
     ORDER BY mml.deducted_at DESC
     LIMIT $2`,
    [factoryId, limit]
  );
  return result.rows;
}

module.exports = {
  listMaterials,
  addMaterial,
  updateMaterial,
  checkAvailability,
  getMaterialMovements,
};
