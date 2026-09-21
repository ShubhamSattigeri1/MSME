const express = require('express');
const {
  listPurchaseOrders,
  raisePurchaseOrder,
  updatePurchaseOrderStatus,
} = require('../services/purchaseOrders');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

router.get('/', async (req, res, next) => {
  try {
    return success(res, await listPurchaseOrders(req.query));
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    return success(res, await raisePurchaseOrder(req.body), 201);
  } catch (err) {
    return next(err);
  }
});

router.put('/:id/status', async (req, res, next) => {
  try {
    const purchaseOrder = await updatePurchaseOrderStatus(req.params.id, req.body.status);

    if (!purchaseOrder) {
      return res.status(404).json({ success: false, error: 'purchase order not found' });
    }

    // Send email to supplier when PO is ordered
    if (req.body.status === 'ordered') {
      try {
        const pool = require('../db');
        const { sendEmail } = require('../services/gmailSender');

        const supplierEmail = req.body.supplier_email || process.env.SUPPLIER_EMAIL || 'sattigeri46@gmail.com';
        const matRes = await pool.query(
          'SELECT m.name FROM materials m WHERE m.id = $1',
          [purchaseOrder.material_id]
        );
        const materialName = matRes.rowCount > 0 ? matRes.rows[0].name : 'Unknown';

        const subject = `Purchase Order #${purchaseOrder.id.slice(-8).toUpperCase()}`;
        const body = `Dear Supplier,\n\nPlease supply the following material:\n\n  - ${materialName}: ${purchaseOrder.qty_ordered}\n\nPlease confirm receipt and delivery date.\n\nThanks,\nFactory Management`;

        await sendEmail({
          factoryId: purchaseOrder.factory_id || req.factoryId,
          to: supplierEmail,
          subject,
          body,
        });
      } catch (emailErr) {
        console.error('[PO] Failed to send email:', emailErr.message);
        // Don't fail the request — PO status already updated
      }
    }

    return success(res, purchaseOrder);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
