const pool = require('../db');

/**
 * Create a stock alert if one doesn't already exist for the same type/material.
 */
async function upsertAlert({ factoryId, materialId, alertType, currentQty, thresholdQty, message }) {
  const existing = await pool.query(
    `SELECT id FROM stock_alerts
     WHERE factory_id = $1 AND material_id = $2 AND alert_type = $3 AND acknowledged = 0`,
    [factoryId, materialId, alertType]
  );
  if (existing.rowCount > 0) return existing.rows[0];

  const result = await pool.query(
    `INSERT INTO stock_alerts (factory_id, material_id, alert_type, current_qty, threshold_qty, message)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [factoryId, materialId, alertType, currentQty, thresholdQty, message]
  );
  return result.rows[0];
}

/**
 * List unacknowledged alerts for a factory.
 */
async function listAlerts(factoryId, acknowledged = false) {
  const result = await pool.query(
    `SELECT sa.*, m.name AS material_name, m.unit AS material_unit
     FROM stock_alerts sa
     JOIN materials m ON m.id = sa.material_id
     WHERE sa.factory_id = $1 AND sa.acknowledged = $2
     ORDER BY sa.created_at DESC`,
    [factoryId, acknowledged ? 1 : 0]
  );
  return result.rows;
}

/**
 * Acknowledge an alert (mark as read).
 */
async function acknowledgeAlert(alertId, factoryId) {
  await pool.query(
    `UPDATE stock_alerts SET acknowledged = 1 WHERE id = $1 AND factory_id = $2`,
    [alertId, factoryId]
  );
}

/**
 * Get count of unacknowledged alerts.
 */
async function getUnacknowledgedCount(factoryId) {
  const result = await pool.query(
    `SELECT COUNT(*) as cnt FROM stock_alerts WHERE factory_id = $1 AND acknowledged = 0`,
    [factoryId]
  );
  return Number(result.rows[0].cnt);
}

module.exports = { upsertAlert, listAlerts, acknowledgeAlert, getUnacknowledgedCount };
