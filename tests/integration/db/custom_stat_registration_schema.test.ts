import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { executeSqlScript, query } from '../../../src/db/client';

const migration = readFileSync(
  join(process.cwd(), 'src/db/tables/013_custom_stat_registration_contract.sql'),
  'utf8',
);

describe('custom-stat registration migration', () => {
  test('installs the audit table and functions idempotently', async () => {
    await executeSqlScript(`
      DROP FUNCTION IF EXISTS register_custom_stat_definition(
        UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, JSONB, TEXT, TEXT
      );
      DROP FUNCTION IF EXISTS list_custom_stat_definitions(UUID);
      DROP TABLE IF EXISTS custom_stat_registration_audit;
    `);

    await executeSqlScript(migration);
    await executeSqlScript(migration);

    const functions = await query<{ name: string }>(
      `SELECT proname AS name
       FROM pg_proc
       WHERE proname IN (
         'list_custom_stat_definitions',
         'register_custom_stat_definition'
       )
       ORDER BY proname`,
    );
    const auditTable = await query<{ name: string }>(
      `SELECT table_name AS name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'custom_stat_registration_audit'`,
    );

    expect(functions.rows).toEqual([
      { name: 'list_custom_stat_definitions' },
      { name: 'register_custom_stat_definition' },
    ]);
    expect(auditTable.rows).toEqual([{ name: 'custom_stat_registration_audit' }]);
  });
});
