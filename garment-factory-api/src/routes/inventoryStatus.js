const express = require('express');
const { getFullStatus, getMaterialStatus, checkThresholds } = require('../services/inventoryEngine');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

// GET /api/inventory/status — full status for all materials
router.get('/status', async (req, res, next) => {
  try {
    return success(res, await getFullStatus(req.factoryId));
  } catch (err) {
    return next(err);
  }
});

// GET /api/inventory/status/:materialId — status for a single material
router.get('/status/:materialId', async (req, res, next) => {
  try {
    const status = await getMaterialStatus(req.params.materialId, req.factoryId);
    if (!status) return res.status(404).json({ success: false, error: 'Material not found' });
    return success(res, status);
  } catch (err) {
    return next(err);
  }
});

// GET /api/inventory/thresholds — check all thresholds and return violations
router.get('/thresholds', async (req, res, next) => {
  try {
    return success(res, await checkThresholds(req.factoryId));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
