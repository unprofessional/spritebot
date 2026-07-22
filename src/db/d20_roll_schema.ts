import { query } from './client';

export async function ensureD20RollTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS d20_roll (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interaction_id TEXT NOT NULL UNIQUE,
      result SMALLINT NOT NULL CHECK (result BETWEEN 1 AND 20),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_d20_roll_created_at ON d20_roll(created_at)
  `);
}
