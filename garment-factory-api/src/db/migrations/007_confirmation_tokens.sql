CREATE TABLE IF NOT EXISTS confirmation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  token VARCHAR(64) UNIQUE NOT NULL,
  action VARCHAR(20) NOT NULL CHECK (action IN ('confirm', 'reject')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_confirmation_tokens_token ON confirmation_tokens(token);
