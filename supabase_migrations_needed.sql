-- 1. Add thread_id to orders (for Gmail reply routing)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS thread_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_orders_thread_id ON orders(thread_id);

-- 2. Add factory_id to messages (used by poller INSERT)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS factory_id UUID;
CREATE INDEX IF NOT EXISTS idx_messages_factory_id ON messages(factory_id);

-- 3. Verify BOM entries exist for your garment types
--    You MUST create BOM entries for each garment type used in orders
--    Example:
--    INSERT INTO bom (garment_type, material_id, qty_per_unit) 
--    VALUES ('t-shirt', '<material-uuid>', 1.5);