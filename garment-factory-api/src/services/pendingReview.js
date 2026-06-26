const pool = require('../db');
const { assertUuid } = require('../utils/validation');

async function createPendingReview(payload) {
  const result = await pool.query(
    `INSERT INTO pending_review (raw_message, source, sender_id, parsed_result, reason, factory_id, missing_fields, followup_needed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      payload.raw_message,
      payload.source || null,
      payload.sender_id || null,
      payload.parsed_result ? JSON.stringify(payload.parsed_result) : null,
      payload.reason,
      payload.factory_id || null,
      payload.missing_fields && payload.missing_fields.length > 0 ? payload.missing_fields : null,
      payload.followup_needed === true ? true : false,
    ]
  );

  return result.rows[0];
}

async function listUnreviewed() {
  const result = await pool.query(
    `SELECT *
     FROM pending_review
     WHERE reviewed = false
     ORDER BY created_at DESC`
  );

  return result.rows;
}

async function listPendingByFactory(factoryId) {
  assertUuid(factoryId, 'factoryId');

  const result = await pool.query(
    `SELECT *
     FROM pending_review
     WHERE factory_id = $1 AND reviewed = false
     ORDER BY created_at DESC`,
    [factoryId]
  );

  return result.rows;
}

async function getPendingReviewById(id) {
  assertUuid(id, 'id');

  const result = await pool.query('SELECT * FROM pending_review WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function markReviewed(id) {
  assertUuid(id, 'id');

  const result = await pool.query(
    `UPDATE pending_review
     SET reviewed = true
     WHERE id = $1
     RETURNING *`,
    [id]
  );

  return result.rows[0] || null;
}

async function dismissPendingReview(id) {
  assertUuid(id, 'id');

  const result = await pool.query(
    `UPDATE pending_review
     SET reviewed = true
     WHERE id = $1
     RETURNING *`,
    [id]
  );

  return result.rows[0] || null;
}

module.exports = {
  createPendingReview,
  getPendingReviewById,
  listUnreviewed,
  listPendingByFactory,
  markReviewed,
  dismissPendingReview,
};
