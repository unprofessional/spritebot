ALTER TABLE rp_channel_mode
  ADD COLUMN IF NOT EXISTS user_id TEXT;

UPDATE rp_channel_mode
SET user_id = updated_by
WHERE user_id IS NULL
  AND updated_by IS NOT NULL;

DELETE FROM rp_channel_mode WHERE user_id IS NULL;

ALTER TABLE rp_channel_mode
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE rp_channel_mode
  DROP CONSTRAINT IF EXISTS rp_channel_mode_pkey;

ALTER TABLE rp_channel_mode
  ADD PRIMARY KEY (guild_id, channel_id, user_id);

ALTER TABLE rp_channel_mode
  DROP COLUMN IF EXISTS updated_by;

DROP INDEX IF EXISTS idx_rp_channel_mode_guild_id;

CREATE INDEX IF NOT EXISTS idx_rp_channel_mode_guild_channel
  ON rp_channel_mode(guild_id, channel_id);
