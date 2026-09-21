-- Add price_breakdown column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_breakdown JSONB;