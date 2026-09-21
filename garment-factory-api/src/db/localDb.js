require('dotenv').config({ override: true });
const Database = require('better-sqlite3');

let db = null;

function getLocalDb() {
  if (db) return db;

  const dbPath = process.env.LOCAL_DB_PATH || './local_factory.db';
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initializeSchema(db);

  return db;
}

function initializeSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS factories (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      storage_mode TEXT DEFAULT 'local',
      onboarding_completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS factory_owners (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      auth_user_id TEXT,
      factory_id TEXT REFERENCES factories(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      buyer_name TEXT NOT NULL,
      buyer_contact TEXT,
      status TEXT DEFAULT 'pending',
      delivery_deadline TEXT,
      total_price REAL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      factory_id TEXT NOT NULL,
      suggested_deadline TEXT,
      deadline_suggestion_factors TEXT,
      source TEXT DEFAULT 'manual',
      buyer_id TEXT,
      negotiated_margin_pct REAL,
      negotiation_notes TEXT,
      negotiation_history TEXT DEFAULT '[]',
      deadline_at_risk INTEGER DEFAULT 0,
      thread_id TEXT,
      price_breakdown TEXT
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
      garment_type TEXT NOT NULL,
      fabric_type TEXT,
      colour TEXT,
      quantity INTEGER NOT NULL,
      size_breakdown TEXT,
      unit_price REAL,
      special_notes TEXT,
      factory_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS buyers (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      company_name TEXT,
      address TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      factory_id TEXT
    );

    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      category TEXT,
      unit TEXT NOT NULL,
      qty_available REAL DEFAULT 0,
      unit_cost REAL NOT NULL,
      supplier_name TEXT,
      reorder_threshold REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      factory_id TEXT NOT NULL,
      supplier_lead_days INTEGER DEFAULT 7
    );

    CREATE TABLE IF NOT EXISTS bom (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      garment_type TEXT NOT NULL,
      material_id TEXT REFERENCES materials(id) ON DELETE RESTRICT,
      qty_per_unit REAL NOT NULL,
      notes TEXT,
      factory_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quotations (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      order_id TEXT REFERENCES orders(id),
      factory_id TEXT,
      quotation_number TEXT,
      data TEXT,
      sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('owner', 'buyer')),
      sender_id TEXT,
      body TEXT NOT NULL,
      is_template INTEGER DEFAULT 0,
      template_key TEXT,
      read_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      factory_id TEXT,
      message_type TEXT DEFAULT 'text',
      proposal_data TEXT,
      proposal_status TEXT
    );

    CREATE TABLE IF NOT EXISTS production_schedule (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
      start_date TEXT,
      expected_completion TEXT,
      current_stage TEXT DEFAULT 'queued',
      updated_at TEXT DEFAULT (datetime('now')),
      factory_id TEXT NOT NULL,
      total_minutes INTEGER DEFAULT 0,
      days_required INTEGER DEFAULT 1,
      deadline_feasible INTEGER DEFAULT 1,
      stage_breakdown TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS production_performance (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
      garment_type TEXT NOT NULL,
      planned_days INTEGER NOT NULL,
      actual_days INTEGER,
      quantity INTEGER NOT NULL,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS material_movement_log (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      order_id TEXT NOT NULL,
      material_id TEXT NOT NULL,
      material_name TEXT NOT NULL,
      garment_type TEXT,
      qty_deducted REAL NOT NULL,
      previous_stock REAL,
      new_stock REAL,
      deducted_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      material_id TEXT REFERENCES materials(id),
      qty_ordered REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      raised_at TEXT DEFAULT (datetime('now')),
      received_at TEXT,
      factory_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS size_multipliers (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      factory_id TEXT NOT NULL,
      size TEXT NOT NULL,
      multiplier REAL NOT NULL DEFAULT 1.0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pricing_settings (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      factory_id TEXT,
      labour_cost_per_min REAL NOT NULL,
      overhead_per_unit REAL NOT NULL,
      default_wastage_pct REAL NOT NULL,
      default_margin_pct REAL NOT NULL,
      minimum_margin_pct REAL DEFAULT 0.05,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pending_review (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      raw_message TEXT NOT NULL,
      source TEXT,
      sender_id TEXT,
      parsed_result TEXT,
      reason TEXT,
      reviewed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      factory_id TEXT,
      missing_fields TEXT,
      followup_needed INTEGER DEFAULT 0,
      followup_sent INTEGER DEFAULT 0,
      followup_at TEXT,
      thread_id TEXT
    );

    CREATE TABLE IF NOT EXISTS garment_pricing_config (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      factory_id TEXT NOT NULL,
      garment_type TEXT NOT NULL,
      labour_cost_per_min REAL,
      overhead_per_unit REAL,
      wastage_pct REAL,
      margin_pct REAL,
      minimum_margin_pct REAL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS confirmation_tokens (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('confirm', 'reject')),
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS gmail_connections (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      factory_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      token_expiry TEXT,
      history_id TEXT,
      last_polled_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS buyer_accounts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      buyer_id TEXT REFERENCES buyers(id) ON DELETE CASCADE,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_bom_garment_type ON bom(garment_type);
    CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);
    CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_buyers_email ON buyers(email);
    CREATE INDEX IF NOT EXISTS idx_buyers_phone ON buyers(phone);
    CREATE INDEX IF NOT EXISTS idx_messages_order_id ON messages(order_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_message_type ON messages(message_type);
    CREATE INDEX IF NOT EXISTS idx_confirmation_tokens_token ON confirmation_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_orders_thread_id ON orders(thread_id);
    CREATE INDEX IF NOT EXISTS idx_pending_review_thread_id ON pending_review(thread_id);
    CREATE INDEX IF NOT EXISTS idx_material_movement_log_deducted_at ON material_movement_log(deducted_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gmail_connections_factory_id ON gmail_connections(factory_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_garment_pricing_config_unique ON garment_pricing_config(factory_id, garment_type);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_size_multipliers_unique ON size_multipliers(factory_id, size);
  `);

  // Seed default size multipliers for factories that don't have them
  const insertSizeMultiplier = database.prepare(
    `INSERT OR IGNORE INTO size_multipliers (factory_id, size, multiplier) VALUES (?, ?, ?)`
  );
  const factoryRows = database.prepare('SELECT id FROM factories').all();
  for (const factory of factoryRows) {
    const defaults = [
      ['S', 1.0], ['L', 1.5],
    ];
    for (const [size, multiplier] of defaults) {
      insertSizeMultiplier.run(factory.id, size, multiplier);
    }
  }
}

module.exports = { getLocalDb };