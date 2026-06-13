ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  negotiated_margin_pct DECIMAL(5,4) DEFAULT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  negotiation_notes TEXT DEFAULT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  negotiation_history JSONB DEFAULT '[]'::jsonb;

ALTER TABLE pricing_settings ADD COLUMN IF NOT EXISTS
  minimum_margin_pct DECIMAL(5,4) DEFAULT 0.05;

UPDATE pricing_settings SET minimum_margin_pct = 0.05 WHERE minimum_margin_pct IS NULL;
