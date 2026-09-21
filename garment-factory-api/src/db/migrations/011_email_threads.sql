ALTER TABLE orders ADD COLUMN IF NOT EXISTS thread_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_orders_thread_id ON orders(thread_id);
