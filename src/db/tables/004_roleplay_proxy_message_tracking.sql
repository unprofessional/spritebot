CREATE TABLE IF NOT EXISTS rp_proxy_message (
  proxy_message_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  character_id UUID REFERENCES character(id) ON DELETE SET NULL,
  webhook_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rp_proxy_message_user_id
  ON rp_proxy_message(user_id);

CREATE INDEX IF NOT EXISTS idx_rp_proxy_message_channel_id
  ON rp_proxy_message(channel_id);
