CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_name VARCHAR(255) NOT NULL,
  buyer_contact VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending',
  delivery_deadline DATE,
  total_price DECIMAL(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT orders_status_check CHECK (status IN ('pending', 'confirmed', 'in_production', 'shipped', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  garment_type VARCHAR(255) NOT NULL,
  fabric_type VARCHAR(255),
  colour VARCHAR(255),
  quantity INTEGER NOT NULL,
  size_breakdown JSONB,
  unit_price DECIMAL(10,2),
  special_notes TEXT,
  CONSTRAINT order_items_quantity_check CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  unit VARCHAR(50) NOT NULL,
  qty_available DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit_cost DECIMAL(10,2) NOT NULL,
  supplier_name VARCHAR(255),
  reorder_threshold DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT materials_category_check CHECK (category IS NULL OR category IN ('fabric', 'thread', 'button', 'zipper', 'lining', 'other')),
  CONSTRAINT materials_qty_available_check CHECK (qty_available >= 0),
  CONSTRAINT materials_unit_cost_check CHECK (unit_cost >= 0),
  CONSTRAINT materials_reorder_threshold_check CHECK (reorder_threshold >= 0)
);

CREATE TABLE IF NOT EXISTS bom (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  garment_type VARCHAR(255) NOT NULL,
  material_id UUID REFERENCES materials(id) ON DELETE RESTRICT,
  qty_per_unit DECIMAL(10,4) NOT NULL,
  notes TEXT,
  CONSTRAINT bom_qty_per_unit_check CHECK (qty_per_unit > 0)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID REFERENCES materials(id),
  qty_ordered DECIMAL(10,2) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  raised_at TIMESTAMPTZ DEFAULT NOW(),
  received_at TIMESTAMPTZ,
  CONSTRAINT purchase_orders_status_check CHECK (status IN ('pending', 'ordered', 'received')),
  CONSTRAINT purchase_orders_qty_ordered_check CHECK (qty_ordered > 0)
);

CREATE TABLE IF NOT EXISTS pricing_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  labour_cost_per_min DECIMAL(8,2) NOT NULL,
  overhead_per_unit DECIMAL(8,2) NOT NULL,
  default_wastage_pct DECIMAL(5,4) NOT NULL,
  default_margin_pct DECIMAL(5,4) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT pricing_settings_labour_check CHECK (labour_cost_per_min >= 0),
  CONSTRAINT pricing_settings_overhead_check CHECK (overhead_per_unit >= 0),
  CONSTRAINT pricing_settings_wastage_check CHECK (default_wastage_pct >= 0),
  CONSTRAINT pricing_settings_margin_check CHECK (default_margin_pct >= 0)
);

CREATE TABLE IF NOT EXISTS production_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  start_date DATE,
  expected_completion DATE,
  current_stage VARCHAR(100) DEFAULT 'queued',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT production_schedule_stage_check CHECK (current_stage IN ('queued', 'cutting', 'stitching', 'finishing', 'qc', 'packing', 'done'))
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_bom_garment_type ON bom(garment_type);
CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);
