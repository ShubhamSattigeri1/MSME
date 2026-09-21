const pool = require('../db');
const { assertOneOf, assertPositiveNumber, assertUuid } = require('../utils/validation');

const PURCHASE_ORDER_STATUSES = ['pending', 'ordered', 'received'];

async function listPurchaseOrders(filters = {}) {
  const values = [];
  let whereClause = '';

  if (filters.status) {
    assertOneOf(filters.status, PURCHASE_ORDER_STATUSES, 'status');
    values.push(filters.status);
    whereClause = 'WHERE po.status = $1';
  }

  const result = await pool.query(
    `SELECT
       po.*,
       m.name AS material_name,
       m.unit AS material_unit
     FROM purchase_orders po
     JOIN materials m ON m.id = po.material_id
     ${whereClause}
     ORDER BY po.raised_at DESC`,
    values
  );

  return result.rows;
}

async function raisePurchaseOrder(payload) {
  assertUuid(payload.material_id, 'material_id');
  assertPositiveNumber(payload.qty_ordered, 'qty_ordered');
  if (payload.status) {
    assertOneOf(payload.status, PURCHASE_ORDER_STATUSES, 'status');
  }

  const materialResult = await pool.query('SELECT id FROM materials WHERE id = $1', [payload.material_id]);
  if (materialResult.rowCount === 0) {
    throw new Error('Material not found');
  }

  const supplierEmail = payload.supplier_email || 'sattigeri46@gmail.com';
  const result = await pool.query(
    `INSERT INTO purchase_orders (material_id, qty_ordered, status, supplier_email)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [payload.material_id, payload.qty_ordered, payload.status || 'pending', supplierEmail]
  );

  return result.rows[0];
}

async function updatePurchaseOrderStatus(id, status) {
  assertUuid(id, 'id');
  assertOneOf(status, ['ordered', 'received'], 'status');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const poResult = await client.query('SELECT * FROM purchase_orders WHERE id = $1::uuid FOR UPDATE', [id]);
    if (poResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const purchaseOrder = poResult.rows[0];
    if (purchaseOrder.status === 'received' && status === 'received') {
      throw new Error('Purchase order already received');
    }

    const updateResult = await client.query(
      `UPDATE purchase_orders
       SET status = $1::text,
           received_at = CASE WHEN $1 = 'received' THEN NOW() ELSE received_at END
       WHERE id = $2::uuid
       RETURNING *`,
      [status, id]
    );

    if (status === 'received') {
      await client.query(
        `UPDATE materials
         SET qty_available = qty_available + $1,
             updated_at = NOW()
         WHERE id = $2::uuid`,
        [purchaseOrder.qty_ordered, purchaseOrder.material_id]
      );
    }

    await client.query('COMMIT');
    return updateResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  PURCHASE_ORDER_STATUSES,
  listPurchaseOrders,
  raisePurchaseOrder,
  updatePurchaseOrderStatus,
};
