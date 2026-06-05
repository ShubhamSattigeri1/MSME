const pool = require('../db');
const { assertNonNegativeNumber, assertPositiveNumber, assertRequired, assertUuid } = require('../utils/validation');

async function listMaterials(filters = {}) {
  const result = await pool.query(
    `SELECT *
     FROM materials
     ${filters.low_stock ? 'WHERE qty_available < reorder_threshold' : ''}
     ORDER BY name`
  );
  return result.rows;
}

async function addMaterial(payload) {
  assertRequired(payload.name, 'name');
  assertRequired(payload.unit, 'unit');
  assertNonNegativeNumber(payload.unit_cost, 'unit_cost');

  const result = await pool.query(
    `INSERT INTO materials
       (name, category, unit, qty_available, unit_cost, supplier_name, reorder_threshold)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
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

  if (updates.qty_available === undefined && updates.unit_cost === undefined) {
    throw new Error('qty_available or unit_cost is required');
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

async function checkAvailability(items) {
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
       WHERE b.garment_type = $1`,
      [item.garment_type]
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

module.exports = {
  listMaterials,
  addMaterial,
  updateMaterial,
  checkAvailability,
};
