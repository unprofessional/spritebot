// src/db/db.ts

import { initDb, query } from './client';
import { getSql } from './sql-loader';

export async function testPgConnection(): Promise<void> {
  try {
    const res = await query('SELECT NOW()');
    console.log('PG Database connected:', res.rows[0].now);
  } catch (err) {
    console.error('❌ Error connecting to the PG database:', err);
  }
}

export async function initializeDB(): Promise<void> {
  await initDb();

  const isProd = process.env.NODE_ENV === 'production';
  const allowProdInit = process.env.ALLOW_DB_INIT === 'true';

  if (isProd && !allowProdInit) {
    console.warn(
      '⚠️ Skipping DB initialization in production. Set ALLOW_DB_INIT=true to override.',
    );
    return;
  }

  try {
    // 🧱 Tracked RPG tables (must ALL be absent to run the full schema file)
    const trackedTables = [
      'game',
      'stat_template',
      'character',
      'player',
      'player_server_link',
      'character_stat_field',
      'character_custom_field',
      'character_inventory',
      'character_inventory_field',
      'thread_bumps', // <— NEW
      'rp_channel_mode',
      'rp_proxy_message',
      'lifecycle_notification_channel',
      'runtime_instance_lease',
      'd20_roll',
    ];

    // 🔍 Check which tables exist
    const checkQuery = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[]);
    `;
    const result = await query<{ table_name: string }>(checkQuery, [trackedTables]);

    const existingTables = result.rows.map((r) => r.table_name);
    const missingTables = trackedTables.filter((name) => !existingTables.includes(name));

    if (existingTables.length > 0) {
      console.warn(
        `⚠️ Skipping DB init — these tables already exist: ${existingTables.sort().join(', ')}`,
      );
      if (missingTables.length > 0) {
        console.info(
          `🟡 Note: still missing: ${missingTables.sort().join(', ')}. ` +
            `Run a migration or drop existing tables before applying the full schema.`,
        );
      }
      return;
    }

    // ✅ Load schema (full create script incl. pgcrypto, triggers, indexes)
    const sql = await getSql('tables', 'tables');

    // 🔒 Keyword safety (prod only)
    const dangerousKeywords = ['DROP ', 'TRUNCATE ', 'DELETE '];
    const found = dangerousKeywords.find((kw) => sql.toUpperCase().includes(kw));
    if (found && isProd) {
      throw new Error(
        `🚨 Refusing to run initialization SQL in production due to dangerous statement: ${found.trim()}`,
      );
    }

    const execResult = await query(sql);

    if (execResult?.rows?.length > 0) {
      throw new Error('❌ Unexpected data returned from schema init query. Aborting.');
    }

    console.log('✅ PG Database initialized successfully.');
  } catch (err) {
    console.error('❌ Error initializing the PG database:', err);
  }
}
