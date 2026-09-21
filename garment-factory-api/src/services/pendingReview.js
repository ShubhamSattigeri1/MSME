const pool = require('../db');
const { assertUuid } = require('../utils/validation');

function parseRow(row) {
  if (!row) return row;
  return {
    ...row,
    parsed_result: typeof row.parsed_result === 'string' ? JSON.parse(row.parsed_result) : row.parsed_result,
    missing_fields: typeof row.missing_fields === 'string' ? JSON.parse(row.missing_fields) : row.missing_fields,
  };
}

async function createPendingReview(payload) {
  const result = await pool.query(
    `INSERT INTO pending_review (raw_message, source, sender_id, parsed_result, reason, factory_id, missing_fields, followup_needed, thread_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      payload.raw_message,
      payload.source || null,
      payload.sender_id || null,
      payload.parsed_result ? JSON.stringify(payload.parsed_result) : null,
      payload.reason,
      payload.factory_id || null,
      payload.missing_fields && payload.missing_fields.length > 0 ? JSON.stringify(payload.missing_fields) : null,
      payload.followup_needed === true ? true : false,
      payload.thread_id || null,
    ]
  );

  return parseRow(result.rows[0]);
}

async function listUnreviewed() {
  const result = await pool.query(
    `SELECT *
     FROM pending_review
     WHERE reviewed = false
     ORDER BY created_at DESC`
  );

  return result.rows.map(parseRow);
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

  return result.rows.map(parseRow);
}

async function getPendingReviewById(id) {
  assertUuid(id, 'id');

  const result = await pool.query('SELECT * FROM pending_review WHERE id = $1', [id]);
  return parseRow(result.rows[0]) || null;
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

  return parseRow(result.rows[0]) || null;
}

async function findPendingByThreadId(threadId, factoryId) {
  if (!threadId) return null;

  const result = await pool.query(
    `SELECT * FROM pending_review WHERE thread_id = $1 AND factory_id = $2 AND reviewed = false ORDER BY created_at DESC LIMIT 1`,
    [threadId, factoryId]
  );

  return result.rowCount > 0 ? parseRow(result.rows[0]) : null;
}

async function findPendingBySenderEmail(senderEmail, factoryId) {
  if (!senderEmail) return null;

  const result = await pool.query(
    `SELECT * FROM pending_review WHERE sender_id = $1 AND factory_id = $2 AND reviewed = false AND followup_sent = true ORDER BY created_at DESC LIMIT 1`,
    [senderEmail, factoryId]
  );

  return result.rowCount > 0 ? parseRow(result.rows[0]) : null;
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

  return parseRow(result.rows[0]) || null;
}

module.exports = {
  createPendingReview,
  getPendingReviewById,
  listUnreviewed,
  listPendingByFactory,
  markReviewed,
  dismissPendingReview,
  findPendingByThreadId,
  findPendingBySenderEmail,
};
