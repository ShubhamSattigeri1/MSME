const express = require('express');
const pool = require('../db');
const ownerAuth = require('../middleware/ownerAuth');
const {
  getAuthUrl,
  getTokensFromCode,
  getAuthenticatedClient,
  refreshAccessToken,
} = require('../services/gmailClient');
const { google } = require('googleapis');

const router = express.Router();

router.get('/connect', ownerAuth, async (req, res, next) => {
  try {
    const authUrl = getAuthUrl(req.factoryId);
    return res.json({ success: true, data: { authUrl } });
  } catch (err) {
    return next(err);
  }
});

router.get('/oauth/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).send('Missing code or state parameter');
    }

    const factoryId = state;
    const tokens = await getTokensFromCode(code);
    const { access_token, refresh_token, expiry_date } = tokens;

    const oAuth2Client = getAuthenticatedClient(access_token, refresh_token, expiry_date);
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    const profile = await gmail.users.getProfile({ userId: 'me' });
    const { emailAddress, historyId } = profile.data;

    await pool.query(
      `INSERT INTO gmail_connections (factory_id, email, access_token, refresh_token, token_expiry, history_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (factory_id) DO UPDATE SET
         email = EXCLUDED.email,
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         token_expiry = EXCLUDED.token_expiry,
         history_id = EXCLUDED.history_id,
         updated_at = NOW()`,
      [factoryId, emailAddress, access_token, refresh_token, expiry_date ? new Date(expiry_date) : null, historyId]
    );

    const dashboardUrl = process.env.OWNER_DASHBOARD_URL || 'http://localhost:3001';
    return res.redirect(`${dashboardUrl}/settings?gmail=connected`);
  } catch (err) {
    return next(err);
  }
});

router.get('/status', ownerAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT email, last_polled_at FROM gmail_connections WHERE factory_id = $1`,
      [req.factoryId]
    );
    if (result.rowCount === 0) {
      return res.json({ success: true, data: { connected: false, email: null, last_polled_at: null } });
    }
    return res.json({ success: true, data: { connected: true, email: result.rows[0].email, last_polled_at: result.rows[0].last_polled_at } });
  } catch (err) {
    return next(err);
  }
});

router.delete('/disconnect', ownerAuth, async (req, res, next) => {
  try {
    await pool.query(`DELETE FROM gmail_connections WHERE factory_id = $1`, [req.factoryId]);
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;