-- ====================================================================
-- Migration 001: SKU-Based Inventory & Production Tracking
-- Run manually: sqlite3 local_factory.db < db/migrate_001_inventory_skus.sql
-- ====================================================================

-- 1. Product attributes (size, color, material)
CREATE TABLE IF NOT EXISTS product_attributes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  factory_id TEXT NOT NULL,
  attr_name TEXT NOT NULL,
  attr_value TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(factory_id, attr_name, attr_value)
);

-- 2. SKUs = attribute combinations (owner-defined codes)
CREATE TABLE IF NOT EXISTS product_skus (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  factory_id TEXT NOT NULL,
  sku_code TEXT NOT NULL,
  attribute_set TEXT NOT NULL,  -- JSON: {"garment_type":"shirt","size":"small","color":"black","material":"cotton"}
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(factory_id, sku_code)
);

-- 3. BOM per SKU (replaces old bom table for SKU-based items)
CREATE TABLE IF NOT EXISTS bom_sku (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  sku_id TEXT REFERENCES product_skus(id),
  material_id TEXT REFERENCES materials(id),
  qty_per_unit REAL NOT NULL,
  unit TEXT NOT NULL,
  factory_id TEXT NOT NULL,
  UNIQUE(sku_id, material_id)
);

-- 4. Reserved inventory (materials allocated to active production)
CREATE TABLE IF NOT EXISTS reserved_inventory (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  factory_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  sku_id TEXT,
  material_id TEXT NOT NULL,
  reserved_qty REAL NOT NULL,
  stage TEXT,
  reserved_at TEXT DEFAULT (datetime('now')),
  released_at TEXT
);

-- 5. Auto-generated purchase orders (supplier-facing)
CREATE TABLE IF NOT EXISTS auto_purchase_orders (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  factory_id TEXT NOT NULL,
  supplier_email TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  factor REAL DEFAULT 2.0,
  created_at TEXT DEFAULT (datetime('now')),
  sent_at TEXT,
  received_at TEXT
);

CREATE TABLE IF NOT EXISTS auto_po_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  po_id TEXT REFERENCES auto_purchase_orders(id),
  material_id TEXT REFERENCES materials(id),
  ordered_qty REAL NOT NULL,
  received_qty REAL DEFAULT 0
);

-- 6. Stock alerts log
CREATE TABLE IF NOT EXISTS stock_alerts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  factory_id TEXT NOT NULL,
  material_id TEXT REFERENCES materials(id),
  alert_type TEXT,
  current_qty REAL,
  threshold_qty REAL,
  message TEXT,
  acknowledged INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 7. Bill processing log
CREATE TABLE IF NOT EXISTS bill_uploads (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  factory_id TEXT NOT NULL,
  filename TEXT,
  raw_text TEXT,
  parsed_json TEXT,
  status TEXT DEFAULT 'pending',  -- pending, processed, error
  error_message TEXT,
  uploaded_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT
);

-- 8. Add columns to existing tables
ALTER TABLE materials ADD COLUMN minimum_qty REAL DEFAULT 50;
ALTER TABLE materials ADD COLUMN reorder_factor REAL DEFAULT 2.0;
ALTER TABLE order_items ADD COLUMN sku_id TEXT REFERENCES product_skus(id);

-- ====================================================================
-- Indexes
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_reserved_inventory_order ON reserved_inventory(order_id);
CREATE INDEX IF NOT EXISTS idx_reserved_inventory_material ON reserved_inventory(material_id);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_factory ON stock_alerts(factory_id);
CREATE INDEX IF NOT EXISTS idx_auto_po_items_po ON auto_po_items(po_id);
CREATE INDEX IF NOT EXISTS idx_bill_uploads_factory ON bill_uploads(factory_id);
