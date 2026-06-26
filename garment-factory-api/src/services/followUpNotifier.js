const pool = require('../db');

/*
 * Make.com Scenario B should watch the pending_review table for rows where
 * followup_needed = true and followup_sent = false, then send a reply to the
 * buyer via the original source (gmail or whatsapp) asking for the missing_fields listed.
 */

async function triggerFollowUp(pendingReviewId, factoryId) {
  const result = await pool.query(
    'SELECT * FROM pending_review WHERE id = $1 AND factory_id = $2',
    [pendingReviewId, factoryId]
  );
  if (result.rowCount === 0) {
    throw new Error('Pending review not found');
  }

  const updated = await pool.query(
    `UPDATE pending_review SET followup_needed = true, followup_sent = false, followup_at = NULL WHERE id = $1 RETURNING *`,
    [pendingReviewId]
  );

  return updated.rows[0];
}

async function sendFollowUpReply(pendingReviewId) {
  const result = await pool.query('SELECT * FROM pending_review WHERE id = $1', [pendingReviewId]);
  if (result.rowCount === 0) {
    throw new Error('Pending review not found');
  }

  await pool.query(
    `UPDATE pending_review SET followup_sent = true, followup_at = NOW() WHERE id = $1`,
    [pendingReviewId]
  );

  const review = result.rows[0];
  return {
    followup_sent: true,
    followup_at: new Date().toISOString(),
    missing_fields: review.missing_fields,
  };
}

module.exports = { triggerFollowUp, sendFollowUpReply };
