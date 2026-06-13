const express = require('express');
const pool = require('../db');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

// GET /api/analytics/production-performance
router.get('/production-performance', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         garment_type,
         ROUND(AVG(planned_days)::numeric, 1) as avg_planned_days,
         ROUND(AVG(CASE WHEN actual_days IS NOT NULL THEN actual_days END)::numeric, 1) as avg_actual_days,
         COUNT(*) as sample_size
       FROM production_performance
       WHERE actual_days IS NOT NULL
       GROUP BY garment_type
       ORDER BY garment_type`
    );
    const rows = result.rows.map(r => ({
      ...r,
      sample_size: Number(r.sample_size),
      variance: r.avg_actual_days && r.avg_planned_days
        ? Number((Number(r.avg_actual_days) - Number(r.avg_planned_days)).toFixed(1))
        : null,
    }));
    return success(res, rows);
  } catch (err) {
    return next(err);
  }
});

// GET /api/analytics/on-time-rate
router.get('/on-time-rate', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         TO_CHAR(completed_at, 'YYYY-MM') as month,
         COUNT(*) as total,
         SUM(CASE WHEN actual_days <= planned_days THEN 1 ELSE 0 END) as on_time
       FROM production_performance
       WHERE completed_at IS NOT NULL
         AND actual_days IS NOT NULL
         AND completed_at >= NOW() - INTERVAL '6 months'
       GROUP BY TO_CHAR(completed_at, 'YYYY-MM')
       ORDER BY month`
    );
    const rows = result.rows.map(r => ({
      month: r.month,
      total: Number(r.total),
      on_time: Number(r.on_time),
      rate: Number(r.total) > 0 ? Number((Number(r.on_time) / Number(r.total) * 100).toFixed(1)) : 0,
    }));
    return success(res, rows);
  } catch (err) {
    return next(err);
  }
});

// GET /api/analytics/queue-load
router.get('/queue-load', async (req, res, next) => {
  try {
    const queueResult = await pool.query(
      `SELECT
         ps.order_id,
         o.buyer_name,
         o.status as order_status,
         ps.current_stage,
         ps.total_minutes,
         ps.start_date,
         ps.expected_completion
       FROM production_schedule ps
       JOIN orders o ON o.id = ps.order_id
       WHERE ps.current_stage != 'done'
       ORDER BY ps.start_date ASC NULLS LAST`
    );

    const summaryResult = await pool.query(
      `SELECT
         COUNT(*) as active_orders,
         COALESCE(SUM(total_minutes), 0) as total_minutes,
         MIN(start_date) as earliest_start,
         MAX(expected_completion) as latest_expected
       FROM production_schedule
       WHERE current_stage != 'done'`
    );

    return success(res, {
      orders: queueResult.rows,
      summary: summaryResult.rows[0] || { active_orders: 0, total_minutes: 0 },
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/analytics/unread-messages
router.get('/unread-messages', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as total_unread
       FROM messages
       WHERE sender_type = 'buyer' AND read_at IS NULL`
    );
    return success(res, { total_unread: Number(result.rows[0].total_unread) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
