ALTER TABLE character
  ADD COLUMN IF NOT EXISTS rp_display_name TEXT,
  ADD COLUMN IF NOT EXISTS rp_display_avatar_url TEXT;

CREATE TABLE IF NOT EXISTS rp_channel_mode (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  is_ic BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_rp_channel_mode_guild_id
  ON rp_channel_mode(guild_id);
