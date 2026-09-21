-- Migration 001: Inventory SKU System
-- Run this manually against your SQLite database

-- ============================================================
-- 1. PRODUCT ATTRIBUTES (factory-defined, extensible)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_attributes (
  id TEXT PRIMARY KEY,
  factory_id TEXT NOT NULL,
  attr_name TEXT NOT NULL,     -- 'size', 'color', 'material'
  attr_value TEXT NOT NULL,    -- 'small', 'black', 'cotton'
  display_order INTEGER DEFAULT 0,
  UNIQUE(factory_id, attr_name, attr_value)
);

-- ============================================================
-- 2. PRODUCT SKUs = attribute combinations (owner-defined codes)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_skus (
  id TEXT PRIMARY KEY,
  factory_id TEXT NOT NULL,
  sku_code TEXT NOT NULL,           -- Owner decides: e.g., "S-BLK-COT"
  attribute_set TEXT NOT NULL,      -- JSON: {"size":"small","color":"black","material":"cotton"}
  active INTEGER DEFAULT 1,
  UNIQUE(factory_id, sku_code)
);

-- ============================================================
-- 3. BOM per SKU (not per garment_type)
-- ============================================================
CREATE TABLE IF NOT EXISTS bom_sku (
  id TEXT PRIMARY KEY,
  sku_id TEXT REFERENCES product_skus(id),
  material_id TEXT REFERENCES materials(id),
  qty_per_unit REAL NOT NULL,
  unit TEXT NOT NULL,              -- 'm2', 'pcs', 'cones'
  factory_id TEXT NOT NULL
);

-- ============================================================
-- 4. RESERVED INVENTORY (materials allocated to active production)
-- ============================================================
CREATE TABLE IF NOT EXISTS reserved_inventory (
  id TEXT PRIMARY KEY,
  factory_id TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id),
  sku_id TEXT REFERENCES product_skus(id),
  material_id TEXT REFERENCES materials(id),
  reserved_qty REAL NOT NULL,
  stage TEXT,                       -- 'cutting', 'stitching', etc.
  reserved_at TEXT DEFAULT (datetime('now')),
  released_at TEXT
);

-- ============================================================
-- 5. PURCHASE ORDERS (auto-generated for suppliers)
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  factory_id TEXT NOT NULL,
  supplier_email TEXT NOT NULL,
  status TEXT DEFAULT 'draft',     -- draft, sent, received, cancelled
  factor REAL DEFAULT 2.0,         -- Adjustable multiplier > 1
  created_at TEXT DEFAULT (datetime('now')),
  sent_at TEXT,
  received_at TEXT
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id TEXT PRIMARY KEY,
  po_id TEXT REFERENCES purchase_orders(id),
  material_id TEXT REFERENCES materials(id),
  ordered_qty REAL NOT NULL,
  received_qty REAL DEFAULT 0
);

-- ============================================================
-- 6. STOCK ALERTS
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_alerts (
  id TEXT PRIMARY KEY,
  factory_id TEXT NOT NULL,
  material_id TEXT REFERENCES materials(id),
  alert_type TEXT,                 -- 'below_minimum', 'below_reorder', 'reserved_exceeds_available'
  current_qty REAL,
  threshold_qty REAL,
  message TEXT,
  acknowledged INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- 7. MATERIAL CONFIG EXTENSIONS
-- ============================================================
-- Add columns to materials table if they don't exist
-- (SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we handle gracefully)
-- Run these as separate statements if needed:
-- ALTER TABLE materials ADD COLUMN minimum_qty REAL DEFAULT 50;
-- ALTER TABLE materials ADD COLUMN reorder_factor REAL DEFAULT 2.0;

-- ============================================================
-- 8. SEED DATA: Attributes (pre-defined per specs)
-- ============================================================
-- Note: Replace 'default_factory' with actual factory_id from your factories table
-- You can get it with: SELECT id FROM factories LIMIT 1;

-- Size attributes
INSERT OR IGNORE INTO product_attributes (id, factory_id, attr_name, attr_value, display_order) VALUES
('attr_size_small', 'default_factory', 'size', 'small', 1),
('attr_size_large', 'default_factory', 'size', 'large', 2);

-- Color attributes
INSERT OR IGNORE INTO product_attributes (id, factory_id, attr_name, attr_value, display_order) VALUES
('attr_color_black', 'default_factory', 'color', 'black', 1),
('attr_color_white', 'default_factory', 'color', 'white', 2);

-- Material attributes
INSERT OR IGNORE INTO product_attributes (id, factory_id, attr_name, attr_value, display_order) VALUES
('attr_mat_cotton', 'default_factory', 'material', 'cotton', 1),
('attr_mat_wool', 'default_factory', 'material', 'wool', 2);

-- ============================================================
-- 9. SEED DATA: Materials (ensure they exist with new columns)
-- ============================================================
-- Note: Update factory_id to match your actual factory
INSERT OR IGNORE INTO materials (id, factory_id, name, category, unit, qty_available, minimum_qty, reorder_factor) VALUES
('mat_buttons', 'default_factory', 'Buttons', 'trims', 'pcs', 1000, 500, 2.0),
('mat_blk_cotton', 'default_factory', 'Black Cotton', 'fabric', 'm2', 100, 50, 2.0),
('mat_wht_cotton', 'default_factory', 'White Cotton', 'fabric', 'm2', 150, 50, 2.0),
('mat_blk_wool', 'default_factory', 'Black Wool', 'fabric', 'm2', 100, 50, 2.0),
('mat_wht_wool', 'default_factory', 'White Wool', 'fabric', 'm2', 150, 50, 2.0);

-- ============================================================
-- 10. SEED DATA: 8 SKUs with BOM mappings
-- ============================================================
-- First, create SKUs (owner defines sku_code)
-- Factory owner will need to update 'default_factory' to actual factory_id

-- Small Black Cotton
INSERT OR IGNORE INTO product_skus (id, factory_id, sku_code, attribute_set) VALUES
('sku_s_blk_cot', 'default_factory', 'S-BLK-COT', '{"size":"small","color":"black","material":"cotton"}');

-- Small Black Wool
INSERT OR IGNORE INTO product_skus (id, factory_id, sku_code, attribute_set) VALUES
('sku_s_blk_wol', 'default_factory', 'S-BLK-WOL', '{"size":"small","color":"black","material":"wool"}');

-- Small White Cotton
INSERT OR IGNORE INTO product_skus (id, factory_id, sku_code, attribute_set) VALUES
('sku_s_wht_cot', 'default_factory', 'S-WHT-COT', '{"size":"small","color":"white","material":"cotton"}');

-- Small White Wool
INSERT OR IGNORE INTO product_skus (id, factory_id, sku_code, attribute_set) VALUES
('sku_s_wht_wol', 'default_factory', 'S-WHT-WOL', '{"size":"small","color":"white","material":"wool"}');

-- Large Black Cotton
INSERT OR IGNORE INTO product_skus (id, factory_id, sku_code, attribute_set) VALUES
('sku_l_blk_cot', 'default_factory', 'L-BLK-COT', '{"size":"large","color":"black","material":"cotton"}');

-- Large Black Wool
INSERT OR IGNORE INTO product_skus (id, factory_id, sku_code, attribute_set) VALUES
('sku_l_blk_wol', 'default_factory', 'L-BLK-WOL', '{"size":"large","color":"black","material":"wool"}');

-- Large White Cotton
INSERT OR IGNORE INTO product_skus (id, factory_id, sku_code, attribute_set) VALUES
('sku_l_wht_cot', 'default_factory', 'L-WHT-COT', '{"size":"large","color":"white","material":"cotton"}');

-- Large White Wool
INSERT OR IGNORE INTO product_skus (id, factory_id, sku_code, attribute_set) VALUES
('sku_l_wht_wol', 'default_factory', 'L-WHT-WOL', '{"size":"large","color":"white","material":"wool"}');

-- ============================================================
-- 11. BOM MAPPINGS: 16 rows (8 SKUs × 2 materials each)
-- ============================================================
-- Small SKUs: 1.0 m² fabric + 5 buttons
-- Large SKUs: 1.5 m² fabric + 7 buttons

-- S-BLK-COT → Black Cotton (1.0 m²) + Buttons (5 pcs)
INSERT OR IGNORE INTO bom_sku (id, sku_id, material_id, qty_per_unit, unit, factory_id) VALUES
('bom_s_blk_cot_fabric', 'sku_s_blk_cot', 'mat_blk_cotton', 1.0, 'm2', 'default_factory'),
('bom_s_blk_cot_btn', 'sku_s_blk_cot', 'mat_buttons', 5, 'pcs', 'default_factory');

-- S-BLK-WOL → Black Wool (1.0 m²) + Buttons (5 pcs)
INSERT OR IGNORE INTO bom_sku (id, sku_id, material_id, qty_per_unit, unit, factory_id) VALUES
('bom_s_blk_wol_fabric', 'sku_s_blk_wol', 'mat_blk_wool', 1.0, 'm2', 'default_factory'),
('bom_s_blk_wol_btn', 'sku_s_blk_wol', 'mat_buttons', 5, 'pcs', 'default_factory');

-- S-WHT-COT → White Cotton (1.0 m²) + Buttons (5 pcs)
INSERT OR IGNORE INTO bom_sku (id, sku_id, material_id, qty_per_unit, unit, factory_id) VALUES
('bom_s_wht_cot_fabric', 'sku_s_wht_cot', 'mat_wht_cotton', 1.0, 'm2', 'default_factory'),
('bom_s_wht_cot_btn', 'sku_s_wht_cot', 'mat_buttons', 5, 'pcs', 'default_factory');

-- S-WHT-WOL → White Wool (1.0 m²) + Buttons (5 pcs)
INSERT OR IGNORE INTO bom_sku (id, sku_id, material_id, qty_per_unit, unit, factory_id) VALUES
('bom_s_wht_wol_fabric', 'sku_s_wht_wol', 'mat_wht_wool', 1.0, 'm2', 'default_factory'),
('bom_s_wht_wol_btn', 'sku_s_wht_wol', 'mat_buttons', 5, 'pcs', 'default_factory');

-- L-BLK-COT → Black Cotton (1.5 m²) + Buttons (7 pcs)
INSERT OR IGNORE INTO bom_sku (id, sku_id, material_id, qty_per_unit, unit, factory_id) VALUES
('bom_l_blk_cot_fabric', 'sku_l_blk_cot', 'mat_blk_cotton', 1.5, 'm2', 'default_factory'),
('bom_l_blk_cot_btn', 'sku_l_blk_cot', 'mat_buttons', 7, 'pcs', 'default_factory');

-- L-BLK-WOL → Black Wool (1.5 m²) + Buttons (7 pcs)
INSERT OR IGNORE INTO bom_sku (id, sku_id, material_id, qty_per_unit, unit, factory_id) VALUES
('bom_l_blk_wol_fabric', 'sku_l_blk_wol', 'mat_blk_wool', 1.5, 'm2', 'default_factory'),
('bom_l_blk_wol_btn', 'sku_l_blk_wol', 'mat_buttons', 7, 'pcs', 'default_factory');

-- L-WHT-COT → White Cotton (1.5 m²) + Buttons (7 pcs)
INSERT OR IGNORE INTO bom_sku (id, sku_id, material_id, qty_per_unit, unit, factory_id) VALUES
('bom_l_wht_cot_fabric', 'sku_l_wht_cot', 'mat_wht_cotton', 1.5, 'm2', 'default_factory'),
('bom_l_wht_cot_btn', 'sku_l_wht_cot', 'mat_buttons', 7, 'pcs', 'default_factory');

-- L-WHT-WOL → White Wool (1.5 m²) + Buttons (7 pcs)
INSERT OR IGNORE INTO bom_sku (id, sku_id, material_id, qty_per_unit, unit, factory_id) VALUES
('bom_l_wht_wol_fabric', 'sku_l_wht_wol', 'mat_wht_wool', 1.5, 'm2', 'default_factory'),
('bom_l_wht_wol_btn', 'sku_l_wht_wol', 'mat_buttons', 7, 'pcs', 'default_factory');

-- ============================================================
-- 12. INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_reserved_inventory_order ON reserved_inventory(order_id);
CREATE INDEX IF NOT EXISTS idx_reserved_inventory_material ON reserved_inventory(material_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_factory ON purchase_orders(factory_id);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_factory ON stock_alerts(factory_id);
CREATE INDEX IF NOT EXISTS idx_bom_sku_sku ON bom_sku(sku_id);
CREATE INDEX IF NOT EXISTS idx_product_skus_factory ON product_skus(factory_id);