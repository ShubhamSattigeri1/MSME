const express = require('express');
const { listSKUs, upsertSKU } = require('../services/skuResolver');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

router.get('/', async (req, res, next) => {
  try {
    return success(res, await listSKUs(req.factoryId));
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const result = await upsertSKU({ ...req.body, factoryId: req.factoryId });
    return success(res, result, 201);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
