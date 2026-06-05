const pool = require('../db');
const { assertUuid } = require('../utils/validation');

async function createPendingReview(payload) {
  const result = await pool.query(
    `INSERT INTO pending_review (raw_message, source, sender_id, parsed_result, reason)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      payload.raw_message,
      payload.source || null,
      payload.sender_id || null,
      payload.parsed_result ? JSON.stringify(payload.parsed_result) : null,
      payload.reason,
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
  markReviewed,
  dismissPendingReview,
};
