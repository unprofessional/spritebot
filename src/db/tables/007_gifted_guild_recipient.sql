ALTER TABLE gifted_guilds
  ADD COLUMN IF NOT EXISTS recipient_member_id TEXT;

CREATE INDEX IF NOT EXISTS idx_gifted_guilds_recipient_member_id
  ON gifted_guilds (recipient_member_id) WHERE recipient_member_id IS NOT NULL;
