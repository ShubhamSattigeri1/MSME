const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SALT_ROUNDS = 10;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return secret;
}

async function createBuyerAccount(buyerId, email, temporaryPassword) {
  const passwordHash = await bcrypt.hash(temporaryPassword, SALT_ROUNDS);
  const result = await pool.query(
    `INSERT INTO buyer_accounts (buyer_id, email, password_hash) VALUES ($1::uuid, $2, $3) RETURNING id, email`,
    [buyerId, email, passwordHash]
  );
  return { account_id: result.rows[0].id, email: result.rows[0].email };
}

async function loginBuyer(email, password) {
  const result = await pool.query(
    'SELECT * FROM buyer_accounts WHERE email = $1',
    [email]
  );
  if (result.rowCount === 0) throw new Error('Invalid email or password');

  const account = result.rows[0];
  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) throw new Error('Invalid email or password');

  await pool.query(
    'UPDATE buyer_accounts SET last_login = NOW() WHERE id = $1::uuid',
    [account.id]
  );

  const token = jwt.sign(
    { buyer_account_id: account.id, buyer_id: account.buyer_id, type: 'buyer' },
    getJwtSecret(),
    { expiresIn: '24h' }
  );

  return { token, buyer_id: account.buyer_id };
}

function verifyBuyerToken(token) {
  return jwt.verify(token, getJwtSecret());
}

module.exports = { createBuyerAccount, loginBuyer, verifyBuyerToken };
