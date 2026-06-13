ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS message_type VARCHAR(50) DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS proposal_data JSONB,
  ADD COLUMN IF NOT EXISTS proposal_status VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_messages_message_type ON messages(message_type);
