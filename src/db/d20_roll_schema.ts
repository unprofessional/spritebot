import { query } from './client';

export async function ensureD20RollTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS d20_roll (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interaction_id TEXT NOT NULL UNIQUE,
      result SMALLINT NOT NULL CHECK (result BETWEEN 1 AND 20),
      user_id TEXT NOT NULL,
      guild_id TEXT,
      channel_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`ALTER TABLE d20_roll ADD COLUMN IF NOT EXISTS user_id TEXT`);
  await query(`ALTER TABLE d20_roll ADD COLUMN IF NOT EXISTS guild_id TEXT`);
  await query(`ALTER TABLE d20_roll ADD COLUMN IF NOT EXISTS channel_id TEXT`);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_d20_roll_created_at ON d20_roll(created_at)
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_d20_roll_guild_created_at
      ON d20_roll(guild_id, created_at)
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_d20_roll_channel_created_at
      ON d20_roll(channel_id, created_at)
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_d20_roll_user_created_at
      ON d20_roll(user_id, created_at)
  `);
}
