const express = require('express');
const pool = require('../db');

const router = express.Router();

router.get('/me', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name, slug, storage_mode, onboarding_completed, created_at FROM factories WHERE id = $1',
      [req.factoryId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Factory not found' });
    }
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

router.put('/storage-mode', async (req, res, next) => {
  try {
    const { mode } = req.body;
    if (!mode || !['cloud', 'local'].includes(mode)) {
      return res.status(400).json({ success: false, error: 'mode must be cloud or local' });
    }

    const result = await pool.query(
      `UPDATE factories SET storage_mode = $1 WHERE id = $2 RETURNING id, name, slug, storage_mode, onboarding_completed`,
      [mode, req.factoryId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Factory not found' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

router.put('/onboarding-complete', async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE factories SET onboarding_completed = true WHERE id = $1 RETURNING id, name, slug, storage_mode, onboarding_completed`,
      [req.factoryId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Factory not found' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
