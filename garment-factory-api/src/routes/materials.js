const express = require('express');
const {
  addMaterial,
  checkAvailability,
  listMaterials,
  updateMaterial,
  getMaterialMovements,
} = require('../services/materials');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

router.get('/', async (req, res, next) => {
  try {
    return success(res, await listMaterials({ ...req.query, factory_id: req.factoryId }));
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    return success(res, await addMaterial({ ...req.body, factory_id: req.factoryId }), 201);
  } catch (err) {
    return next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const material = await updateMaterial(req.params.id, req.body);

    if (!material) {
      return res.status(404).json({ success: false, error: 'material not found' });
    }

    return success(res, material);
  } catch (err) {
    return next(err);
  }
});

router.post('/availability', async (req, res, next) => {
  try {
    return success(res, await checkAvailability(req.body.items, req.factoryId));
  } catch (err) {
    return next(err);
  }
});

router.get('/movements', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    return success(res, await getMaterialMovements(req.factoryId, limit));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
