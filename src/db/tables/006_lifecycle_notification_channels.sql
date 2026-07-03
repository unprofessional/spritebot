CREATE TABLE IF NOT EXISTS lifecycle_notification_channel (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_notification_channel_channel_id
  ON lifecycle_notification_channel(channel_id);
