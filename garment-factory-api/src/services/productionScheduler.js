const pool = require('../db');
const { assertUuid } = require('../utils/validation');

const STAGE_SEQUENCE = ['cutting', 'stitching', 'finishing', 'quality_check', 'packing'];

const MINUTES_PER_PIECE = {
  cutting: 3,
  finishing: 4,
  quality_check: 2,
  packing: 1,
};

const STITCHING_MINUTES = {
  default: 15,
  'formal shirt': 22,
  't-shirt': 10,
  'kurta': 18,
  'denim jeans': 30,
  'kids frock': 12,
  'ladies kurti': 16,
};

const WORKING_HOURS_PER_DAY = 8;
const WORKERS = 20;
const DAILY_CAPACITY_MINUTES = WORKERS * WORKING_HOURS_PER_DAY * 60;

function isSunday(date) {
  return date.getDay() === 0;
}

function addWorkingDays(startDate, days) {
  const result = new Date(startDate);
  let remaining = days;

  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    if (!isSunday(result)) {
      remaining--;
    }
  }

  return result;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

async function scheduleOrder(orderId) {
  assertUuid(orderId, 'orderId');

  const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (orderRes.rowCount === 0) throw new Error('Order not found');
  const order = orderRes.rows[0];

  const itemsRes = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
  const items = itemsRes.rows;

  let totalMinutes = 0;
  const stageBreakdown = {};

  for (const stage of STAGE_SEQUENCE) {
    stageBreakdown[stage] = 0;
  }

  for (const item of items) {
    const qty = Number(item.quantity);
    const garmentType = (item.garment_type || '').toLowerCase();
    const stitchingMin = STITCHING_MINUTES[garmentType] || STITCHING_MINUTES.default;

    const perPiece = MINUTES_PER_PIECE.cutting + stitchingMin + MINUTES_PER_PIECE.finishing + MINUTES_PER_PIECE.quality_check + MINUTES_PER_PIECE.packing;
    const itemTotal = perPiece * qty;

    stageBreakdown.cutting += MINUTES_PER_PIECE.cutting * qty;
    stageBreakdown.stitching += stitchingMin * qty;
    stageBreakdown.finishing += MINUTES_PER_PIECE.finishing * qty;
    stageBreakdown.quality_check += MINUTES_PER_PIECE.quality_check * qty;
    stageBreakdown.packing += MINUTES_PER_PIECE.packing * qty;

    totalMinutes += itemTotal;
  }

  const today = new Date();
  const startDay = isSunday(today) ? addWorkingDays(today, 1) : new Date(today);
  const daysRequired = Math.ceil(totalMinutes / DAILY_CAPACITY_MINUTES);
  const expectedCompletion = addWorkingDays(startDay, daysRequired);

  const deliveryDeadline = order.delivery_deadline ? new Date(order.delivery_deadline) : null;
  const deadlineFeasible = deliveryDeadline ? expectedCompletion <= deliveryDeadline : true;

  const scheduleRes = await pool.query(
    `INSERT INTO production_schedule (order_id, start_date, expected_completion, total_minutes, days_required, deadline_feasible, current_stage, stage_breakdown)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      orderId,
      formatDate(startDay),
      formatDate(expectedCompletion),
      totalMinutes,
      daysRequired,
      deadlineFeasible,
      'queued',
      stageBreakdown,
    ]
  );

  if (!deadlineFeasible) {
    await pool.query(
      `UPDATE orders SET deadline_at_risk = true, updated_at = NOW() WHERE id = $1`,
      [orderId]
    );

    try {
      const notifier = require('./notifier');
      await notifier.sendDeadlineAtRisk(order, scheduleRes.rows[0]);
    } catch (e) {
      console.error('[NOTIFY] Failed to send deadline at risk notification:', e.message);
    }
  }

  return {
    ...scheduleRes.rows[0],
    stage_breakdown: stageBreakdown,
    deadline_feasible: deadlineFeasible,
    delivery_deadline: order.delivery_deadline,
  };
}

async function advanceStage(orderId) {
  assertUuid(orderId, 'orderId');

  const scheduleRes = await pool.query(
    'SELECT * FROM production_schedule WHERE order_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [orderId]
  );

  if (scheduleRes.rowCount === 0) throw new Error('No production schedule found for this order');

  const schedule = scheduleRes.rows[0];
  const currentStage = schedule.current_stage;

  const fullSequence = ['queued', ...STAGE_SEQUENCE, 'done'];
  const currentIndex = fullSequence.indexOf(currentStage);

  if (currentIndex === -1 || currentIndex >= fullSequence.length - 1) {
    throw new Error('Order is already at the final stage');
  }

  const nextStage = fullSequence[currentIndex + 1];

  await pool.query(
    'UPDATE production_schedule SET current_stage = $1, updated_at = NOW() WHERE id = $2',
    [nextStage, schedule.id]
  );

  if (nextStage === 'done') {
    await pool.query(
      "UPDATE orders SET status = 'shipped', updated_at = NOW() WHERE id = $1",
      [orderId]
    );

    // Track actual completion in production_performance
    try {
      const startDate = schedule.start_date ? new Date(schedule.start_date) : new Date();
      const today = new Date();
      const actualDays = Math.ceil((today - startDate) / (1000 * 60 * 60 * 24));

      const itemsRes = await pool.query('SELECT garment_type, quantity FROM order_items WHERE order_id = $1', [orderId]);
      for (const item of itemsRes.rows) {
        await pool.query(
          `INSERT INTO production_performance (order_id, garment_type, planned_days, actual_days, quantity, completed_at)
           VALUES ($1::uuid, $2, $3, $4, $5, NOW())`,
          [orderId, item.garment_type, schedule.days_required, actualDays, Number(item.quantity)]
        );
      }
    } catch (err) {
      console.error('[SCHEDULER] Failed to record production performance:', err.message);
    }
  }

  return { previous_stage: currentStage, current_stage: nextStage };
}

module.exports = {
  scheduleOrder,
  advanceStage,
  STAGE_SEQUENCE,
  MINUTES_PER_PIECE,
  STITCHING_MINUTES,
  DAILY_CAPACITY_MINUTES,
  isSunday,
  addWorkingDays,
};
