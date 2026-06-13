ALTER TABLE orders ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual';
UPDATE orders SET source = 'manual' WHERE source IS NULL;
