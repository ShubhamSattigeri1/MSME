const pool = require('../db');
const { google } = require('googleapis');
const { getAuthenticatedClient, refreshAccessToken } = require('./gmailClient');

async function sendEmail({ factoryId, from, to, subject, body, threadId, inReplyTo, references }) {
  const connRes = await pool.query(
    'SELECT * FROM gmail_connections WHERE factory_id = $1',
    [factoryId]
  );
  if (connRes.rowCount === 0) {
    throw new Error('Gmail not connected for this factory');
  }

  const connection = connRes.rows[0];

  if (connection.token_expiry) {
    const expiryMs = new Date(connection.token_expiry).getTime();
    if (Date.now() >= expiryMs - 300000) {
      const credentials = await refreshAccessToken(connection.refresh_token);
      await pool.query(
        `UPDATE gmail_connections SET access_token = $1, token_expiry = $2, updated_at = NOW() WHERE factory_id = $3`,
        [credentials.access_token, new Date(credentials.expiry_date), factoryId]
      );
      connection.access_token = credentials.access_token;
      connection.token_expiry = new Date(credentials.expiry_date);
    }
  }

  const auth = getAuthenticatedClient(connection.access_token, connection.refresh_token, connection.token_expiry);
  const gmail = google.gmail({ version: 'v1', auth });

  const senderEmail = from || connection.email;
  const headers = [
    `From: ${senderEmail}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
  ];

  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
  }
  if (references) {
    headers.push(`References: ${references}`);
  } else if (inReplyTo) {
    headers.push(`References: ${inReplyTo}`);
  }

  const rawMessage = headers.join('\r\n') + '\r\n\r\n' + body;

  const encodedMessage = Buffer.from(rawMessage, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const sendParams = {
    userId: 'me',
    resource: { raw: encodedMessage },
  };

  if (threadId) {
    sendParams.resource.threadId = threadId;
  }

  const sent = await gmail.users.messages.send(sendParams);
  return { messageId: sent.data.id, threadId: sent.data.threadId };
}

module.exports = { sendEmail };