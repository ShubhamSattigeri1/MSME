const pool = require('../db');
const { assertPositiveNumber, assertRequired, assertUuid } = require('../utils/validation');

async function listBom(filters = {}) {
  const values = [];
  const conditions = [];

  if (filters.factory_id) {
    values.push(filters.factory_id);
    conditions.push(`b.factory_id = $${values.length}`);
  }

  if (filters.garment_type) {
    values.push(filters.garment_type);
    conditions.push(`b.garment_type = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT
       b.*,
       m.name AS material_name,
       m.category AS material_category,
       m.unit AS material_unit
     FROM bom b
     JOIN materials m ON m.id = b.material_id
     ${where}
     ORDER BY b.garment_type, m.name`,
    values
  );

  return result.rows;
}

async function addBomEntry(payload) {
  assertRequired(payload.factory_id, 'factory_id');
  assertRequired(payload.garment_type, 'garment_type');
  assertUuid(payload.material_id, 'material_id');
  assertPositiveNumber(payload.qty_per_unit, 'qty_per_unit');

  const materialResult = await pool.query('SELECT id FROM materials WHERE id = $1', [payload.material_id]);
  if (materialResult.rowCount === 0) {
    throw new Error('Material not found');
  }

  const result = await pool.query(
    `INSERT INTO bom (factory_id, garment_type, material_id, qty_per_unit, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [payload.factory_id, payload.garment_type, payload.material_id, payload.qty_per_unit, payload.notes || null]
  );

  return result.rows[0];
}

async function updateBomQty(id, qtyPerUnit) {
  assertUuid(id, 'id');
  assertPositiveNumber(qtyPerUnit, 'qty_per_unit');

  const result = await pool.query(
    `UPDATE bom
     SET qty_per_unit = $1
     WHERE id = $2
     RETURNING *`,
    [qtyPerUnit, id]
  );

  return result.rows[0] || null;
}

async function deleteBomEntry(id) {
  assertUuid(id, 'id');
  const result = await pool.query('DELETE FROM bom WHERE id = $1 RETURNING *', [id]);
  return result.rows[0] || null;
}

module.exports = {
  listBom,
  addBomEntry,
  updateBomQty,
  deleteBomEntry,
};
