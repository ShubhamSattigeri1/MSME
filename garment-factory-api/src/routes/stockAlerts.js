const express = require('express');
const { listAlerts, acknowledgeAlert, getUnacknowledgedCount } = require('../services/stockAlerts');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

// GET /api/stock-alerts — list unacknowledged (default) or all
router.get('/', async (req, res, next) => {
  try {
    const showAll = req.query.all === 'true';
    return success(res, await listAlerts(req.factoryId, showAll));
  } catch (err) {
    return next(err);
  }
});

// GET /api/stock-alerts/count — unacknowledged count
router.get('/count', async (req, res, next) => {
  try {
    return success(res, { count: await getUnacknowledgedCount(req.factoryId) });
  } catch (err) {
    return next(err);
  }
});

// PUT /api/stock-alerts/:id/acknowledge
router.put('/:id/acknowledge', async (req, res, next) => {
  try {
    await acknowledgeAlert(req.params.id, req.factoryId);
    return success(res, { acknowledged: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
