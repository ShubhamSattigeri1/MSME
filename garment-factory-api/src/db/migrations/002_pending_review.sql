CREATE TABLE IF NOT EXISTS pending_review (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_message TEXT NOT NULL,
  source VARCHAR(50),
  sender_id VARCHAR(255),
  parsed_result JSONB,
  reason VARCHAR(255),
  reviewed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
