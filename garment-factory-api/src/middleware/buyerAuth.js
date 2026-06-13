const { verifyBuyerToken } = require('../services/buyerAuth');

function buyerAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const token = header.slice(7);
  try {
    const payload = verifyBuyerToken(token);
    req.buyer = payload;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
}

module.exports = buyerAuth;
