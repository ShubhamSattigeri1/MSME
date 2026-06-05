const express = require('express');
const {
  createOrder,
  getOrderById,
  listOrders,
  updateOrderStatus,
} = require('../services/orders');

const pricingEngine = require('../services/pricingEngine');
const quotationService = require('../services/quotationGenerator');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

router.get('/', async (req, res, next) => {
  try {
    return success(res, await listOrders(req.query));
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const result = await createOrder(req.body);
    return success(res, result, 201);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const order = await getOrderById(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, error: 'order not found' });
    }

    // include price breakdown: recalculate if total_price is null
    try {
      const price = await pricingEngine.calculateOrderPrice(req.params.id);
      return success(res, { ...order, price_breakdown: price });
    } catch (e) {
      // if pricing fails, still return order
      return success(res, order);
    }
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/quotation', async (req, res, next) => {
  try {
    const q = await quotationService.generateQuotation(req.params.id);
    return success(res, q, 201);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id/quotation', async (req, res, next) => {
  try {
    const q = await quotationService.getLastQuotation(req.params.id);
    if (!q) return res.status(404).json({ success: false, error: 'quotation not found' });
    return success(res, q);
  } catch (err) {
    return next(err);
  }
});

router.put('/:id/status', async (req, res, next) => {
  try {
    const order = await updateOrderStatus(req.params.id, req.body.status);

    if (!order) {
      return res.status(404).json({ success: false, error: 'order not found' });
    }

    return success(res, order);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
