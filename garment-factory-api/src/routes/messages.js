const express = require('express');
const { sendMessage, getMessages, markMessagesRead, getUnreadCount } = require('../services/messaging');
const { TEMPLATES } = require('../config/messageTemplates');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function failure(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

// GET /api/orders/:orderId/messages
router.get('/orders/:orderId/messages', async (req, res, next) => {
  try {
    const messages = await getMessages(req.params.orderId);
    await markMessagesRead(req.params.orderId, 'owner');
    const unread = await getUnreadCount(req.params.orderId, 'owner');
    return success(res, { messages, unread_count: unread });
  } catch (err) {
    return next(err);
  }
});

// POST /api/orders/:orderId/messages
router.post('/orders/:orderId/messages', async (req, res, next) => {
  try {
    const { body, template_key } = req.body || {};
    if (!body && !template_key) return failure(res, 'body is required');
    const message = await sendMessage(req.params.orderId, 'owner', body || '', {
      templateKey: template_key,
      senderId: 'owner',
    });
    return success(res, message, 201);
  } catch (err) {
    return next(err);
  }
});

// GET /api/messages/templates
router.get('/messages/templates', (req, res) => {
  return success(res, Object.values(TEMPLATES));
});

module.exports = router;
