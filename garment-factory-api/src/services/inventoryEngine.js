const pool = require('../db');
const { getSKUBOM } = require('./skuResolver');

/**
 * Reserve materials for an order when production starts (queued → cutting).
 * For each order_item with a sku_id, calculate required qty from SKU BOM
 * and insert into reserved_inventory.
 */
async function reserve(orderId, factoryId) {
  const itemsRes = await pool.query(
    `SELECT oi.*, ps.sku_code, ps.attribute_set
     FROM order_items oi
     JOIN product_skus ps ON ps.id = oi.sku_id
     WHERE oi.order_id = $1 AND oi.factory_id = $2`,
    [orderId, factoryId]
  );

  if (itemsRes.rowCount === 0) {
    console.warn(`[INVENTORY ENGINE] No SKU-linked items found for order ${orderId}`);
    return { materials: [], alerts: [] };
  }

  const alerts = [];
  const materials = [];

  for (const item of itemsRes.rows) {
    const bom = await getSKUBOM(item.sku_id, factoryId);

    for (const b of bom) {
      const requiredQty = Number(b.qty_per_unit) * Number(item.quantity);

      // Insert reserved inventory record
      await pool.query(
        `INSERT INTO reserved_inventory (factory_id, order_id, sku_id, material_id, reserved_qty, stage)
         VALUES ($1, $2, $3, $4, $5, 'cutting')`,
        [factoryId, orderId, item.sku_id, b.material_id, requiredQty]
      );

      materials.push({
        material_id: b.material_id,
        material_name: b.material_name,
        reserved_qty: requiredQty,
      });

      // Check thresholds
      const stat = await getMaterialStatus(b.material_id, factoryId);
      if (stat.available - stat.reserved < stat.minimum_qty) {
        alerts.push({
          material_id: b.material_id,
          material_name: b.material_name,
          alert_type: 'below_minimum',
          current_qty: stat.available,
          threshold_qty: stat.minimum_qty,
          message: `${b.material_name}: Available (${stat.available}) - Reserved (${stat.reserved}) < Minimum (${stat.minimum_qty})`,
        });
      }
    }
  }

  return { materials, alerts };
}

/**
 * Release reserved inventory for a completed/cancelled order.
 */
async function release(orderId, factoryId) {
  await pool.query(
    `UPDATE reserved_inventory SET released_at = datetime('now')
     WHERE order_id = $1 AND factory_id = $2 AND released_at IS NULL`,
    [orderId, factoryId]
  );
}

/**
 * Get total reserved qty for a material (across all active orders).
 */
async function getReserved(materialId, factoryId) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(reserved_qty), 0) as total
     FROM reserved_inventory
     WHERE material_id = $1 AND factory_id = $2 AND released_at IS NULL`,
    [materialId, factoryId]
  );
  return Number(result.rows[0].total);
}

/**
 * Get the current available stock for a material.
 */
async function getAvailable(materialId, factoryId) {
  const result = await pool.query(
    `SELECT qty_available FROM materials WHERE id = $1 AND factory_id = $2`,
    [materialId, factoryId]
  );
  if (result.rowCount === 0) return 0;
  return Number(result.rows[0].qty_available);
}

/**
 * Get the minimum_qty and reorder_factor for a material.
 */
async function getThresholds(materialId, factoryId) {
  const result = await pool.query(
    `SELECT minimum_qty, reorder_factor FROM materials WHERE id = $1 AND factory_id = $2`,
    [materialId, factoryId]
  );
  if (result.rowCount === 0) return { minimum_qty: 50, reorder_factor: 2.0 };
  const row = result.rows[0];
  return {
    minimum_qty: Number(row.minimum_qty),
    reorder_factor: Number(row.reorder_factor),
  };
}

/**
 * Get full status for a single material: available, reserved, total, minimum, factor.
 */
async function getMaterialStatus(materialId, factoryId) {
  const matResult = await pool.query(
    `SELECT id, name, qty_available, unit, minimum_qty, reorder_factor
     FROM materials WHERE id = $1 AND factory_id = $2`,
    [materialId, factoryId]
  );
  if (matResult.rowCount === 0) return null;

  const mat = matResult.rows[0];
  const reserved = await getReserved(materialId, factoryId);
  const available = Number(mat.qty_available);
  const minimum = mat.minimum_qty != null ? Number(mat.minimum_qty) : 50;
  const factor = mat.reorder_factor != null ? Number(mat.reorder_factor) : 2.0;

  return {
    material_id: mat.id,
    material_name: mat.name,
    unit: mat.unit,
    available,
    reserved,
    total: available + reserved,
    minimum_qty: minimum,
    reorder_factor: factor,
  };
}

/**
 * Get full inventory status for all materials in a factory.
 */
async function getFullStatus(factoryId) {
  const materials = await pool.query(
    `SELECT id FROM materials WHERE factory_id = $1 ORDER BY name`,
    [factoryId]
  );

  const results = [];
  for (const mat of materials.rows) {
    const status = await getMaterialStatus(mat.id, factoryId);
    if (status) results.push(status);
  }

  return results;
}

/**
 * Check all materials for thresholds and return violations.
 */
async function checkThresholds(factoryId) {
  const statuses = await getFullStatus(factoryId);
  const alerts = [];

  for (const s of statuses) {
    // Below minimum
    if (s.available < s.minimum_qty) {
      alerts.push({
        material_id: s.material_id,
        material_name: s.material_name,
        alert_type: 'below_minimum',
        current_qty: s.available,
        threshold_qty: s.minimum_qty,
        message: `${s.material_name} stock (${s.available} ${s.unit}) is below minimum (${s.minimum_qty} ${s.unit})`,
      });
    }

    // Reserved exceeds available
    if (s.reserved > s.available) {
      alerts.push({
        material_id: s.material_id,
        material_name: s.material_name,
        alert_type: 'reserved_exceeds_available',
        current_qty: s.available,
        threshold_qty: s.reserved,
        message: `${s.material_name}: Reserved (${s.reserved} ${s.unit}) exceeds available (${s.available} ${s.unit})`,
      });
    }

    // Need reorder
    const requiredForReorder = Math.ceil(s.reserved * s.reorder_factor);
    if (requiredForReorder > s.available) {
      alerts.push({
        material_id: s.material_id,
        material_name: s.material_name,
        alert_type: 'reorder_needed',
        current_qty: s.available,
        threshold_qty: requiredForReorder,
        message: `${s.material_name}: Available (${s.available} ${s.unit}) < Required×${s.reorder_factor} (${requiredForReorder} ${s.unit})`,
      });
    }
  }

  return alerts;
}

module.exports = {
  reserve,
  release,
  getReserved,
  getAvailable,
  getThresholds,
  getMaterialStatus,
  getFullStatus,
  checkThresholds,
};
