const pool = require('../db');
const { getReserved, getAvailable, getThresholds, checkThresholds } = require('./inventoryEngine');
const { sendEmail } = require('./gmailSender');
const { upsertAlert } = require('./stockAlerts');

/**
 * Check all materials and generate POs where needed.
 * Factor = reorder_factor (default 2.0, adjustable per material > 1).
 * Formula: if available < (reserved × factor), order shortfall.
 */
async function checkAndGenerate(factoryId, supplierEmail) {
  const alerts = await checkThresholds(factoryId);
  // Filter only reorder_needed alerts
  const reorderAlerts = alerts.filter(a => a.alert_type === 'reorder_needed');
  if (reorderAlerts.length === 0) {
    console.log('[AUTO PO] No reorder needed');
    return { created: 0, pos: [] };
  }

  const supplier = supplierEmail || process.env.SUPPLIER_EMAIL;
  if (!supplier) {
    console.warn('[AUTO PO] No supplier email configured');
    return { created: 0, pos: [], error: 'No supplier email' };
  }

  // Create a single PO for all materials
  const poResult = await pool.query(
    `INSERT INTO auto_purchase_orders (factory_id, supplier_email, status, factor)
     VALUES ($1, $2, 'draft', $3) RETURNING *`,
    [factoryId, supplier, 2.0]
  );
  const po = poResult.rows[0];

  const items = [];
  for (const alert of reorderAlerts) {
    const thresholds = await getThresholds(alert.material_id, factoryId);
    const reserved = await getReserved(alert.material_id, factoryId);
    const available = await getAvailable(alert.material_id, factoryId);
    const factor = thresholds.reorder_factor;

    if (factor <= 1) {
      console.warn(`[AUTO PO] Factor for material ${alert.material_name} is ${factor}, skipping (must be > 1)`);
      continue;
    }

    const required = Math.ceil(reserved * factor);
    const shortfall = Math.max(0, required - available);
    if (shortfall <= 0) continue;

    await pool.query(
      `INSERT INTO auto_po_items (po_id, material_id, ordered_qty, received_qty) VALUES ($1, $2, $3, 0)`,
      [po.id, alert.material_id, shortfall]
    );

    items.push({
      material_name: alert.material_name,
      ordered_qty: shortfall,
    });
  }

  if (items.length === 0) {
    await pool.query(`DELETE FROM auto_purchase_orders WHERE id = $1`, [po.id]);
    return { created: 0, pos: [] };
  }

  // Send email to supplier
  const subject = `Purchase Order #${po.id.slice(-8).toUpperCase()} - Material Reorder`;
  let body = `Dear Supplier,\n\nPlease supply the following materials:\n\n`;
  for (const item of items) {
    body += `  - ${item.material_name}: ${item.ordered_qty}\n`;
  }
  body += `\nPlease confirm receipt and delivery date.\n\nThanks,\nFactory Management`;

  try {
    await sendEmail({
      factoryId,
      to: supplier,
      subject,
      body,
    });
    await pool.query(
      `UPDATE auto_purchase_orders SET status = 'sent', sent_at = datetime('now') WHERE id = $1`,
      [po.id]
    );
  } catch (err) {
    console.error(`[AUTO PO] Failed to send email for PO ${po.id}:`, err.message);
    // PO stays as draft
  }

  // Create stock alerts for each item
  for (const item of items) {
    await pool.query(
      `INSERT INTO stock_alerts (factory_id, material_id, alert_type, current_qty, threshold_qty, message)
       SELECT $1, $2, 'auto_po_sent', m.qty_available, $3,
              'Auto PO sent: ' || $4 || ' x ' || $5 || ' units'
       FROM materials m WHERE m.id = $2`,
      [factoryId, item.ordered_qty, item.material_name, item.ordered_qty]
    );
  }

  return { created: 1, pos: [{ po_id: po.id, items }] };
}

module.exports = { checkAndGenerate };
