const express = require('express');
const pool = require('../db');
const { checkAndGenerate } = require('../services/autoPO');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

// GET /api/auto-purchase-orders — list all auto POs
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT apo.*,
              json_group_array(
                json_object('material_id', api.material_id,
                           'material_name', m.name,
                           'ordered_qty', api.ordered_qty,
                           'received_qty', api.received_qty)
              ) as items
       FROM auto_purchase_orders apo
       LEFT JOIN auto_po_items api ON api.po_id = apo.id
       LEFT JOIN materials m ON m.id = api.material_id
       WHERE apo.factory_id = $1
       GROUP BY apo.id
       ORDER BY apo.created_at DESC`,
      [req.factoryId]
    );

    for (const po of result.rows) {
      if (typeof po.items === 'string') {
        try { po.items = JSON.parse(po.items); } catch { po.items = []; }
      }
    }

    return success(res, result.rows);
  } catch (err) {
    return next(err);
  }
});

// POST /api/auto-purchase-orders/generate — trigger PO check manually
router.post('/generate', async (req, res, next) => {
  try {
    const supplierEmail = req.body.supplier_email || process.env.SUPPLIER_EMAIL;
    const result = await checkAndGenerate(req.factoryId, supplierEmail);
    return success(res, result);
  } catch (err) {
    return next(err);
  }
});

// PUT /api/auto-purchase-orders/:id/receive — mark PO as received
router.put('/:id/receive', async (req, res, next) => {
  try {
    const poResult = await pool.query(
      `UPDATE auto_purchase_orders SET status = 'received', received_at = datetime('now')
       WHERE id = $1 AND factory_id = $2 RETURNING *`,
      [req.params.id, req.factoryId]
    );
    if (poResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'PO not found' });
    }

    // Update received_qty for all items
    await pool.query(
      `UPDATE auto_po_items SET received_qty = ordered_qty WHERE po_id = $1`,
      [req.params.id]
    );

    // Update material qty_available
    const items = await pool.query(
      `SELECT material_id, ordered_qty FROM auto_po_items WHERE po_id = $1`,
      [req.params.id]
    );
    for (const item of items.rows) {
      await pool.query(
        `UPDATE materials SET qty_available = qty_available + $1, updated_at = datetime('now') WHERE id = $2`,
        [item.ordered_qty, item.material_id]
      );
    }

    return success(res, poResult.rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
