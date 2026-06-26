const express = require('express');
const pool = require('../db');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function failure(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM garment_pricing_config WHERE factory_id = $1 ORDER BY garment_type',
      [req.factoryId]
    );
    return success(res, result.rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { garment_type, labour_cost_per_min, overhead_per_unit, wastage_pct, margin_pct, minimum_margin_pct, notes } = req.body;
    if (!garment_type) return failure(res, 'garment_type is required');

    const result = await pool.query(
      `INSERT INTO garment_pricing_config
         (factory_id, garment_type, labour_cost_per_min, overhead_per_unit, wastage_pct, margin_pct, minimum_margin_pct, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (factory_id, garment_type) DO UPDATE SET
         labour_cost_per_min = EXCLUDED.labour_cost_per_min,
         overhead_per_unit = EXCLUDED.overhead_per_unit,
         wastage_pct = EXCLUDED.wastage_pct,
         margin_pct = EXCLUDED.margin_pct,
         minimum_margin_pct = EXCLUDED.minimum_margin_pct,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING *`,
      [
        req.factoryId,
        garment_type,
        labour_cost_per_min != null ? labour_cost_per_min : null,
        overhead_per_unit != null ? overhead_per_unit : null,
        wastage_pct != null ? wastage_pct : null,
        margin_pct != null ? margin_pct : null,
        minimum_margin_pct != null ? minimum_margin_pct : null,
        notes || null,
      ]
    );

    return success(res, result.rows[0], 201);
  } catch (err) {
    return next(err);
  }
});

router.get('/:garment_type', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM garment_pricing_config WHERE factory_id = $1 AND garment_type = $2',
      [req.factoryId, req.params.garment_type]
    );
    if (result.rowCount === 0) return failure(res, 'Config not found', 404);
    return success(res, result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.put('/:garment_type', async (req, res, next) => {
  try {
    const { labour_cost_per_min, overhead_per_unit, wastage_pct, margin_pct, minimum_margin_pct, notes } = req.body;

    const result = await pool.query(
      `UPDATE garment_pricing_config SET
         labour_cost_per_min = COALESCE($1, labour_cost_per_min),
         overhead_per_unit = COALESCE($2, overhead_per_unit),
         wastage_pct = COALESCE($3, wastage_pct),
         margin_pct = COALESCE($4, margin_pct),
         minimum_margin_pct = COALESCE($5, minimum_margin_pct),
         notes = COALESCE($6, notes),
         updated_at = NOW()
       WHERE factory_id = $7 AND garment_type = $8
       RETURNING *`,
      [
        labour_cost_per_min != null ? labour_cost_per_min : null,
        overhead_per_unit != null ? overhead_per_unit : null,
        wastage_pct != null ? wastage_pct : null,
        margin_pct != null ? margin_pct : null,
        minimum_margin_pct != null ? minimum_margin_pct : null,
        notes !== undefined ? notes : null,
        req.factoryId,
        req.params.garment_type,
      ]
    );

    if (result.rowCount === 0) return failure(res, 'Config not found', 404);
    return success(res, result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete('/:garment_type', async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM garment_pricing_config WHERE factory_id = $1 AND garment_type = $2 RETURNING *',
      [req.factoryId, req.params.garment_type]
    );
    if (result.rowCount === 0) return failure(res, 'Config not found', 404);
    return success(res, { deleted: true, garment_type: req.params.garment_type });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
