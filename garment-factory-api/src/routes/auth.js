const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

router.post('/signup', async (req, res, next) => {
  try {
    const { full_name, email, password, factory_name, factory_slug } = req.body;

    if (!full_name || !email || !password || !factory_name || !factory_slug) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }

    if (!/^[a-z0-9-]+$/.test(factory_slug)) {
      return res.status(400).json({ success: false, error: 'factory_slug must be lowercase alphanumeric with hyphens only' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const slugCheck = await pool.query('SELECT id FROM factories WHERE slug = $1', [factory_slug]);
    if (slugCheck.rowCount > 0) {
      return res.status(409).json({ success: false, error: 'Factory slug is already taken' });
    }

    const emailCheck = await pool.query('SELECT id FROM factory_owners WHERE email = $1', [email]);
    if (emailCheck.rowCount > 0) {
      return res.status(409).json({ success: false, error: 'Email is already registered' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const factoryRes = await client.query(
        `INSERT INTO factories (name, slug, storage_mode) VALUES ($1, $2, 'cloud') RETURNING id`,
        [factory_name, factory_slug]
      );
      const factoryId = factoryRes.rows[0].id;

      await client.query(
        `INSERT INTO factory_owners (auth_user_id, factory_id, full_name, email, password_hash) VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [factoryId, full_name, email, password_hash]
      );

      await client.query('COMMIT');

      return res.status(201).json({
        success: true,
        data: { factoryId, slug: factory_slug, fullName: full_name }
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    return next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      `SELECT fo.id as owner_id, fo.factory_id, fo.full_name, fo.password_hash, fo.email, f.slug, f.name as factory_name
       FROM factory_owners fo
       JOIN factories f ON f.id = fo.factory_id
       WHERE fo.email = $1`,
      [email]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const owner = result.rows[0];
    const valid = await bcrypt.compare(password, owner.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { ownerId: owner.owner_id, factoryId: owner.factory_id, slug: owner.slug },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      data: { token, factoryId: owner.factory_id, slug: owner.slug, fullName: owner.full_name, factoryName: owner.factory_name }
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    if (!req.ownerId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const result = await pool.query(
      `SELECT fo.id, fo.factory_id, fo.full_name, fo.email, fo.created_at,
              f.name as factory_name, f.slug as factory_slug, f.storage_mode
       FROM factory_owners fo
       JOIN factories f ON f.id = fo.factory_id
       WHERE fo.id = $1`,
      [req.ownerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Owner not found' });
    }

    const owner = result.rows[0];
    return res.json({
      success: true,
      data: {
        id: owner.id,
        factoryId: owner.factory_id,
        fullName: owner.full_name,
        email: owner.email,
        factoryName: owner.factory_name,
        factorySlug: owner.factory_slug,
        storageMode: owner.storage_mode,
        createdAt: owner.created_at
      }
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
