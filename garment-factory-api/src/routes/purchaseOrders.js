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

    return success(res, purchaseOrder);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
