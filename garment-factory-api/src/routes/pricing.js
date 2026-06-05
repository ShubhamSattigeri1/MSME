const express = require('express');
const {
  calculateOrderPrice,
  getPricingSettings,
  updatePricingSettings,
} = require('../services/pricing');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

router.get('/settings', async (req, res, next) => {
  try {
    return success(res, await getPricingSettings());
  } catch (err) {
    return next(err);
  }
});

router.put('/settings', async (req, res, next) => {
  try {
    return success(res, await updatePricingSettings(req.body));
  } catch (err) {
    return next(err);
  }
});

router.post('/orders/:orderId/calculate', async (req, res, next) => {
  try {
    return success(res, await calculateOrderPrice(req.params.orderId, req.body));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
