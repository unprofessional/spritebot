import { query } from '../../../src/db/client';
import { ensureD20RollTable } from '../../../src/db/d20_roll_schema';

describe('d20 roll schema startup ensure', () => {
  test('is idempotent and makes the telemetry table available', async () => {
    await ensureD20RollTable();
    await ensureD20RollTable();

    const result = await query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'd20_roll'`,
    );

    expect(result.rows).toEqual([{ table_name: 'd20_roll' }]);

    const columns = await query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'd20_roll'
         AND column_name IN ('user_id', 'guild_id', 'channel_id')
       ORDER BY column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: 'channel_id' },
      { column_name: 'guild_id' },
      { column_name: 'user_id' },
    ]);
  });
});
