-- Add deadline_at_risk to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deadline_at_risk BOOLEAN DEFAULT false;

-- Extend production_schedule with required columns
ALTER TABLE production_schedule ADD COLUMN IF NOT EXISTS total_minutes INTEGER DEFAULT 0;
ALTER TABLE production_schedule ADD COLUMN IF NOT EXISTS days_required INTEGER DEFAULT 1;
ALTER TABLE production_schedule ADD COLUMN IF NOT EXISTS deadline_feasible BOOLEAN DEFAULT true;
ALTER TABLE production_schedule ADD COLUMN IF NOT EXISTS stage_breakdown JSONB DEFAULT '{}'::jsonb;

-- Drop old CHECK constraint and recreate with full stage list
ALTER TABLE production_schedule DROP CONSTRAINT IF EXISTS production_schedule_stage_check;
ALTER TABLE production_schedule ADD CONSTRAINT production_schedule_stage_check
  CHECK (current_stage IN ('queued', 'cutting', 'stitching', 'finishing', 'quality_check', 'packing', 'done'));
