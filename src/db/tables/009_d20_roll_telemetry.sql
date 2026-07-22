CREATE TABLE IF NOT EXISTS d20_roll (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id TEXT NOT NULL UNIQUE,
  result SMALLINT NOT NULL CHECK (result BETWEEN 1 AND 20),
  user_id TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_d20_roll_created_at ON d20_roll(created_at);
CREATE INDEX IF NOT EXISTS idx_d20_roll_user_created_at ON d20_roll(user_id, created_at);
