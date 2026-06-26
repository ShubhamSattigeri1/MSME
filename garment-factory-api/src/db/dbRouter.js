/*
 * DB Router — routes queries to cloud (PostgreSQL) or local (SQLite) per factory.
 *
 * To enable local DB routing for a service, replace:
 *   const pool = require('../db')
 * with:
 *   const { getDb } = require('../db/dbRouter')
 * and change:
 *   pool.query(...)
 * to:
 *   (await getDb(factoryId)).query(...)
 */

const pool = require('./index');
const { runLocalQuery } = require('./localDb');

const cache = new Map();
const CACHE_TTL_MS = 60000;

function createLocalWrapper() {
  return {
    query: async (sql, params) => runLocalQuery(sql, params),
  };
}

async function getDb(factoryId) {
  const cached = cache.get(factoryId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.mode === 'local' ? createLocalWrapper() : pool;
  }

  const result = await pool.query(
    'SELECT storage_mode FROM factories WHERE id = $1',
    [factoryId]
  );

  if (result.rowCount === 0) {
    throw new Error(`Factory not found: ${factoryId}`);
  }

  const mode = result.rows[0].storage_mode;

  cache.set(factoryId, {
    mode,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return mode === 'local' ? createLocalWrapper() : pool;
}

function clearCache(factoryId) {
  cache.delete(factoryId);
}

module.exports = { getDb, clearCache };
