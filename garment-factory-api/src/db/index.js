require('dotenv').config({ override: true });
const { getLocalDb } = require('./localDb');

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function serializeParams(params) {
  const obj = {};
  (params || []).forEach((p, i) => {
    const key = `p${i + 1}`;
    if (p === null || p === undefined) {
      obj[key] = null;
    } else if (Buffer.isBuffer(p)) {
      obj[key] = p;
    } else if (typeof p === 'boolean') {
      obj[key] = p ? 1 : 0;
    } else if (typeof p === 'object') {
      if (p instanceof Date) {
        obj[key] = p.toISOString();
      } else {
        obj[key] = JSON.stringify(p);
      }
    } else {
      obj[key] = p;
    }
  });
  return obj;
}

function normalizeSqlForSQLite(sql) {
  let normalized = sql
    .replace(/::uuid/gi, '')
    .replace(/::jsonb/gi, '')
    .replace(/::text/gi, '')
    .replace(/::timestamp/gi, '')
    .replace(/::date/gi, '')
    .replace(/::float/gi, '')
    .replace(/::numeric/gi, '')
    .replace(/::int/gi, '')
    .replace(/NOW\(\)/gi, "datetime('now')")
    .replace(/CURRENT_TIMESTAMP/gi, "datetime('now')")
    .replace(/CURRENT_DATE/gi, "date('now')")
    .replace(/gen_random_uuid\(\)/gi, "(SELECT lower(substr(hex(blob),1,8)||'-'||substr(hex(blob),9,4)||'-4'||substr(hex(blob),13,3)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(blob),17,3)||'-'||substr(hex(blob),21,12)) FROM (SELECT randomblob(16) AS blob))")
    .replace(/jsonb_agg\(/gi, "json_group_array(");

  normalized = normalized.replace(
    /TO_CHAR\(([^,]+),\s*'([^']+)'\)/gi,
    (match, col, fmt) => {
      const sqliteFmt = fmt
        .replace(/YYYY/g, '%Y')
        .replace(/MM/g, '%m')
        .replace(/DD/g, '%d')
        .replace(/HH24/g, '%H')
        .replace(/MI/g, '%M')
        .replace(/SS/g, '%S');
      return `strftime('${sqliteFmt}', ${col.trim()})`;
    }
  );

  normalized = normalized.replace(
    /EXTRACT\((\w+)\s+FROM\s+(\w+)\)/gi,
    (match, part, col) => {
      if (part.toUpperCase() === 'YEAR') return `CAST(strftime('%Y', ${col}) AS INTEGER)`;
      return match;
    }
  );

  normalized = normalized.replace(
    /datetime\('now'\)\s*-\s*INTERVAL\s+'([^']+)'/gi,
    (match, interval) => {
      const parts = interval.trim().split(/\s+/);
      if (parts.length === 2) {
        return `datetime('now', '-${parts[0]} ${parts[1]}')`;
      }
      return `datetime('now', '-${interval.trim()}')`;
    }
  );

  normalized = normalized
    .replace(/\bILIKE\b/gi, 'LIKE')
    .replace(/\bFOR UPDATE\b/gi, '')
    .replace(/\bNULLS LAST\b/gi, '')
    .replace(/\bNULLS FIRST\b/gi, '')
    .replace(/\$(\d+)/g, '$p$1');

  return normalized;
}

function createClientWrapper(db) {
  return {
    query: async (sql, params = []) => {
      const normalized = normalizeSqlForSQLite(sql);
      const upper = normalized.trim().toUpperCase();
      const isSelect = upper.startsWith('SELECT') || upper.startsWith('WITH');
      const hasReturning = sql.toUpperCase().includes('RETURNING');
      const sqlParams = serializeParams(params);

      try {
        if (isSelect) {
          const rows = db.prepare(normalized).all(sqlParams);
          return { rows, rowCount: rows.length };
        }

        if (hasReturning) {
          const rows = db.prepare(normalized).all(sqlParams);
          return { rows, rowCount: rows.length };
        }

        const result = db.prepare(normalized).run(sqlParams);
        return { rows: [], rowCount: result.changes };
      } catch (e) {
        console.error('[DB ERROR]', e.message);
        console.error('  SQL:', normalized);
        console.error('  Params:', sqlParams);
        throw e;
      }
    },
    release: () => {},
  };
}

const pool = {
  query: async (sql, params = []) => {
    const db = getLocalDb();
    const normalized = normalizeSqlForSQLite(sql);
    const upper = normalized.trim().toUpperCase();
    const isSelect = upper.startsWith('SELECT') || upper.startsWith('WITH');
    const hasReturning = sql.toUpperCase().includes('RETURNING');
    const sqlParams = serializeParams(params);

    try {
      if (isSelect) {
        const rows = db.prepare(normalized).all(sqlParams);
        return { rows, rowCount: rows.length };
      }

      if (hasReturning) {
        const rows = db.prepare(normalized).all(sqlParams);
        return { rows, rowCount: rows.length };
      }

      const result = db.prepare(normalized).run(sqlParams);
      return { rows: [], rowCount: result.changes };
    } catch (e) {
      console.error('[DB ERROR]', e.message);
      console.error('  SQL:', normalized);
      console.error('  Params:', sqlParams);
      throw e;
    }
  },

  connect: async () => {
    const db = getLocalDb();
    let inTransaction = false;
    
    return {
      query: async (sql, params = []) => {
        const normalized = normalizeSqlForSQLite(sql);
        const upper = normalized.trim().toUpperCase();
        const isSelect = upper.startsWith('SELECT') || upper.startsWith('WITH');
        const hasReturning = sql.toUpperCase().includes('RETURNING');
        const sqlParams = serializeParams(params);

        try {
          if (isSelect) {
            const rows = db.prepare(normalized).all(sqlParams);
            return { rows, rowCount: rows.length };
          }

          if (hasReturning) {
            const rows = db.prepare(normalized).all(sqlParams);
            return { rows, rowCount: rows.length };
          }

          const result = db.prepare(normalized).run(sqlParams);
          return { rows: [], rowCount: result.changes };
        } catch (e) {
          console.error('[DB ERROR]', e.message);
          console.error('  SQL:', normalized);
          console.error('  Params:', sqlParams);
          throw e;
        }
      },
      release: () => {
        if (inTransaction) {
          try { db.exec('ROLLBACK'); } catch {}
        }
      },
      begin: () => { db.exec('BEGIN'); inTransaction = true; },
      commit: () => { db.exec('COMMIT'); inTransaction = false; },
      rollback: () => { db.exec('ROLLBACK'); inTransaction = false; },
    };
  },

  end: async () => {
    const db = getLocalDb();
    db.close();
  },

  on: (event, handler) => {
    if (event === 'error') {
      console.log('[DB] Error handler registered');
    }
  },
};

module.exports = pool;