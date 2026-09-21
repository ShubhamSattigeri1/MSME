const pool = require('../db');
const { google } = require('googleapis');
const { getAuthenticatedClient, refreshAccessToken } = require('./gmailClient');
const { processIncomingMessage } = require('./intakeProcessor');

const POLL_INTERVAL_MS = 120000;

function getHeader(headers, name) {
  const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : '';
}

function extractEmail(fromHeader) {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader.trim();
}

function extractEmailBody(payload) {
  if (!payload) return '';

  function decodeBase64(data) {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  }

  function getTextFromPart(part) {
    if (part.mimeType === 'text/plain' && part.body && part.body.data) {
      return decodeBase64(part.body.data);
    }
    if (part.mimeType === 'text/html' && part.body && part.body.data) {
      const html = decodeBase64(part.body.data);
      return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }
    if (part.parts) {
      for (const subPart of part.parts) {
        const result = getTextFromPart(subPart);
        if (result) return result;
      }
    }
    return '';
  }

  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    return decodeBase64(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        return decodeBase64(part.body.data);
      }
    }

    for (const part of payload.parts) {
      const result = getTextFromPart(part);
      if (result) return result;
    }
  }

  if (payload.body && payload.body.data) {
    return decodeBase64(payload.body.data);
  }

  return '';
}

async function refreshIfNeeded(connection) {
  if (!connection.token_expiry) return;

  const expiryMs = new Date(connection.token_expiry).getTime();
  if (Date.now() >= expiryMs - 300000) {
    const credentials = await refreshAccessToken(connection.refresh_token);
    await pool.query(
      `UPDATE gmail_connections SET access_token = $1, token_expiry = $2, updated_at = NOW() WHERE factory_id = $3`,
      [credentials.access_token, new Date(credentials.expiry_date), connection.factory_id]
    );
    connection.access_token = credentials.access_token;
    connection.token_expiry = new Date(credentials.expiry_date);
  }
}

async function pollFactory(connection) {
  await refreshIfNeeded(connection);

  const auth = getAuthenticatedClient(connection.access_token, connection.refresh_token, connection.token_expiry);
  const gmail = google.gmail({ version: 'v1', auth });

  let messageIds = [];
  let newHistoryId = connection.history_id;

  try {
    if (connection.history_id) {
      const historyRes = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: connection.history_id,
        historyTypes: ['messageAdded'],
      });

      newHistoryId = historyRes.data.historyId;

      if (historyRes.data.history) {
        for (const entry of historyRes.data.history) {
          if (entry.messages) {
            for (const msg of entry.messages) {
              messageIds.push(msg.id);
            }
          }
        }
      }
    } else {
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 10,
        q: 'is:unread',
      });

      if (listRes.data.messages) {
        messageIds = listRes.data.messages.map(m => m.id);
      }

      const profile = await gmail.users.getProfile({ userId: 'me' });
      newHistoryId = profile.data.historyId;
    }
  } catch (err) {
    if (err.code === 404 && connection.history_id) {
      console.log(`[GMAIL POLLER] HistoryId expired for factory ${connection.factory_id}, falling back to unread scan`);

      const listRes = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 10,
        q: 'is:unread',
      });

      if (listRes.data.messages) {
        messageIds = listRes.data.messages.map(m => m.id);
      }

      const profile = await gmail.users.getProfile({ userId: 'me' });
      newHistoryId = profile.data.historyId;
    } else {
      throw err;
    }
  }

  const uniqueIds = [...new Set(messageIds)];

  for (const messageId of uniqueIds) {
    try {
      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const msg = msgRes.data;
      const headers = msg.payload.headers;
      const from = getHeader(headers, 'From');
      const subject = getHeader(headers, 'Subject');
      const threadId = msg.threadId;
      const body = extractEmailBody(msg.payload);

      const senderEmail = extractEmail(from);
      if (senderEmail && senderEmail.toLowerCase() === connection.email.toLowerCase()) {
        continue;
      }

      if (threadId) {
        const replyRes = await pool.query(
          'SELECT id FROM orders WHERE thread_id = $1 AND factory_id = $2',
          [threadId, connection.factory_id]
        );
        if (replyRes.rowCount > 0) {
          const orderId = replyRes.rows[0].id;
          await pool.query(
            `INSERT INTO messages (order_id, sender_type, sender_id, body, factory_id)
             VALUES ($1, 'buyer', $2, $3, $4)`,
            [orderId, senderEmail, body, connection.factory_id]
          );
          continue;
        }
      }

      await processIncomingMessage({
        factory_id: connection.factory_id,
        source: 'gmail',
        sender: senderEmail || from,
        raw_message: `Subject: ${subject}\n\n${body}`,
        thread_id: threadId,
      });
    } catch (err) {
      console.error(`[GMAIL POLLER] Failed to process message ${messageId} for factory ${connection.factory_id}:`, err.message);
    }
  }

  if (newHistoryId) {
    await pool.query(
      `UPDATE gmail_connections SET history_id = $1, last_polled_at = NOW(), updated_at = NOW() WHERE factory_id = $2`,
      [newHistoryId, connection.factory_id]
    );
  }
}

async function pollAll() {
  try {
    const result = await pool.query(
      `SELECT * FROM gmail_connections
       WHERE last_polled_at IS NULL
          OR last_polled_at < NOW() - INTERVAL '2 minutes'`
    );

    console.log(`[GMAIL POLLER] Checking ${result.rowCount} factories...`);

    for (const row of result.rows) {
      try {
        await pollFactory(row);
      } catch (err) {
        console.error(`[GMAIL POLLER] Error polling factory ${row.factory_id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[GMAIL POLLER] Poll cycle error:', err.message);
  }
}

function startPolling() {
  console.log('[GMAIL POLLER] Starting polling loop...');
  pollAll();
  setInterval(pollAll, POLL_INTERVAL_MS);
}

module.exports = { startPolling };