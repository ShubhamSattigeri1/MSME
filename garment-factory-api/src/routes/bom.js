const express = require('express');
const {
  addBomEntry,
  deleteBomEntry,
  listBom,
  updateBomQty,
} = require('../services/bom');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

router.get('/', async (req, res, next) => {
  try {
    return success(res, await listBom(req.query));
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    return success(res, await addBomEntry(req.body), 201);
  } catch (err) {
    return next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const entry = await updateBomQty(req.params.id, req.body.qty_per_unit);

    if (!entry) {
      return res.status(404).json({ success: false, error: 'bom entry not found' });
    }

    return success(res, entry);
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const entry = await deleteBomEntry(req.params.id);

    if (!entry) {
      return res.status(404).json({ success: false, error: 'bom entry not found' });
    }

    return success(res, { deleted: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
