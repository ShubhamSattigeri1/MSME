const express = require('express');
const { scheduleOrder, advanceStage } = require('../services/productionScheduler');
const pool = require('../db');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

router.post('/:orderId/schedule', async (req, res, next) => {
  try {
    const schedule = await scheduleOrder(req.params.orderId, req.factoryId);
    return success(res, schedule, 201);
  } catch (err) {
    return next(err);
  }
});

router.post('/:orderId/advance-stage', async (req, res, next) => {
  try {
    const result = await advanceStage(req.params.orderId, req.factoryId);
    return success(res, { order_id: req.params.orderId, ...result });
  } catch (err) {
    return next(err);
  }
});

router.get('/calendar', async (req, res, next) => {
  try {
    const factoryId = req.factoryId;
    const { from, to } = req.query;
    let query = `
      SELECT
        ps.id,
        ps.order_id,
        ps.start_date,
        ps.expected_completion,
        ps.current_stage,
        ps.total_minutes,
        ps.days_required,
        ps.deadline_feasible,
        ps.stage_breakdown,
        ps.updated_at,
        o.buyer_name,
        o.buyer_contact,
        o.delivery_deadline,
        o.status AS order_status,
        o.deadline_at_risk,
        COALESCE(
          (SELECT jsonb_agg(oi.garment_type) FROM order_items oi WHERE oi.order_id = ps.order_id),
          '[]'::jsonb
        ) AS garment_types,
        COALESCE(
          (SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = ps.order_id),
          0
        ) AS total_quantity
      FROM production_schedule ps
      JOIN orders o ON o.id = ps.order_id
    `;
    const values = [];
    const conditions = [];

    values.push(factoryId);
    conditions.push(`o.factory_id = $1`);

    if (from) {
      values.push(from);
      conditions.push(`ps.expected_completion >= $${values.length}`);
    }
    if (to) {
      values.push(to);
      conditions.push(`ps.start_date <= $${values.length}`);
    }

    query += ` WHERE ${conditions.join(' AND ')}`;

    query += ' ORDER BY ps.expected_completion ASC';

    const result = await pool.query(query, values);
    return success(res, result.rows);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
