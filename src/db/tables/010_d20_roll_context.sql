ALTER TABLE d20_roll ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE d20_roll ADD COLUMN IF NOT EXISTS guild_id TEXT;
ALTER TABLE d20_roll ADD COLUMN IF NOT EXISTS channel_id TEXT;

CREATE INDEX IF NOT EXISTS idx_d20_roll_guild_created_at
  ON d20_roll(guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_d20_roll_channel_created_at
  ON d20_roll(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_d20_roll_user_created_at
  ON d20_roll(user_id, created_at);
