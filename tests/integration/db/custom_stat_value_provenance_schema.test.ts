import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { executeSqlScript, query } from '../../../src/db/client';

const migration = readFileSync(
  join(process.cwd(), 'src/db/tables/014_custom_stat_write_provenance.sql'),
  'utf8',
);

describe('custom-stat value provenance migration', () => {
  test('installs its table and functions idempotently', async () => {
    await executeSqlScript(`
      DROP FUNCTION IF EXISTS apply_custom_stat_value(
        UUID, TEXT, UUID, UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT,
        TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT
      );
      DROP FUNCTION IF EXISTS get_custom_stat_value_state(UUID, TEXT, UUID, UUID);
      DROP TABLE IF EXISTS custom_stat_value_provenance;
    `);

    await executeSqlScript(migration);
    await executeSqlScript(migration);

    const functions = await query<{ name: string }>(
      `SELECT proname AS name
       FROM pg_proc
       WHERE proname IN (
         'apply_custom_stat_value',
         'get_custom_stat_value_state'
       )
       ORDER BY proname`,
    );
    const provenanceTable = await query<{ name: string }>(
      `SELECT table_name AS name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'custom_stat_value_provenance'`,
    );

    expect(functions.rows).toEqual([
      { name: 'apply_custom_stat_value' },
      { name: 'get_custom_stat_value_state' },
    ]);
    expect(provenanceTable.rows).toEqual([{ name: 'custom_stat_value_provenance' }]);
  });
});
