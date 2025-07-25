// src/db/db.ts

import { Pool } from 'pg';
import { pgDb, pgHost, pgPass, pgPort, pgUser } from '../config/env_config';
import { getSql } from './sql-loader';

const pool = new Pool({
  user: pgUser,
  host: pgHost,
  database: pgDb,
  password: pgPass,
  port: parseInt(pgPort),
});

export async function testPgConnection(): Promise<void> {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('PG Database connected:', res.rows[0].now);
  } catch (err) {
    console.error('❌ Error connecting to the PG database:', err);
  }
}

export async function initializeDB(): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';
  const allowProdInit = process.env.ALLOW_DB_INIT === 'true';

  if (isProd && !allowProdInit) {
    console.warn(
      '⚠️ Skipping DB initialization in production. Set ALLOW_DB_INIT=true to override.',
    );
    return;
  }

  try {
    // 🧱 Tracked RPG tables
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
    ];

    // 🔍 Check which tables exist
    const checkQuery = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[]);
    `;
    const result = await pool.query<{ table_name: string }>(checkQuery, [trackedTables]);

    const existingTables = result.rows.map((r) => r.table_name);
    const missingTables = trackedTables.filter((name) => !existingTables.includes(name));

    if (existingTables.length > 0) {
      console.warn(
        `⚠️ Skipping DB init — the following RPG tables already exist: ${existingTables.sort().join(', ')}`,
      );
      if (missingTables.length > 0) {
        console.info(
          `🟡 Note: the following RPG tables are still missing: ${missingTables.sort().join(', ')}`,
        );
      }
      return;
    }

    // ✅ Load schema
    const sql = await getSql('tables', 'tables');

    // 🔒 Keyword safety (prod only)
    const dangerousKeywords = ['DROP ', 'TRUNCATE ', 'DELETE '];
    const found = dangerousKeywords.find((kw) => sql.toUpperCase().includes(kw));
    if (found && isProd) {
      throw new Error(
        `🚨 Refusing to run initialization SQL in production due to dangerous statement: ${found.trim()}`,
      );
    }

    const execResult = await pool.query(sql);

    if (execResult?.rows?.length > 0) {
      throw new Error('❌ Unexpected data returned from schema init query. Aborting.');
    }

    console.log('✅ PG Database initialized successfully.');
  } catch (err) {
    console.error('❌ Error initializing the PG database:', err);
  }
}
