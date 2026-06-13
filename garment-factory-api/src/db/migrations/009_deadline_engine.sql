CREATE TABLE IF NOT EXISTS production_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  garment_type VARCHAR(255) NOT NULL,
  planned_days INTEGER NOT NULL,
  actual_days INTEGER,
  quantity INTEGER NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS suggested_deadline DATE DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deadline_suggestion_factors JSONB DEFAULT NULL;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS supplier_lead_days INTEGER DEFAULT 7;

UPDATE materials SET supplier_lead_days = 7 WHERE supplier_lead_days IS NULL;
