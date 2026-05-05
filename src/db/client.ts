import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { pgDb, pgHost, pgPass, pgPort, pgUser } from '../config/env_config';
import { getSql } from './sql-loader';

type PgLite = {
  query<T>(
    text: string,
    params?: unknown[],
  ): Promise<{
    rows: T[];
    affectedRows?: number;
  }>;
  exec(text: string): Promise<unknown>;
  close(): Promise<void>;
};

export interface DbClient {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
  close?(): Promise<void>;
}

type TestDbState = {
  client?: DbClient;
  pgLite?: PgLite;
  initPromise?: Promise<void>;
  actualClose?: () => Promise<void>;
  schemaApplied?: boolean;
};

const TEST_DB_STATE_KEY = '__SOULBOT_TEST_DB_STATE__';

let client: DbClient | undefined;
let pool: Pool | undefined;

function getTestDbState(): TestDbState {
  const globalRecord = globalThis as Record<string, unknown>;

  if (!globalRecord[TEST_DB_STATE_KEY]) {
    globalRecord[TEST_DB_STATE_KEY] = {};
  }

  return globalRecord[TEST_DB_STATE_KEY] as TestDbState;
}

function createPgPool(): Pool {
  return new Pool({
    user: pgUser,
    host: pgHost,
    database: pgDb,
    password: pgPass,
    port: Number(pgPort),
  });
}

function prepareSchemaForPgLite(sql: string): string {
  return sql
    .replace(/CREATE EXTENSION.*?;/gi, '')
    .replace(/CREATE\s+(UNIQUE\s+)?INDEX[\s\S]*?;/gi, '');
}

function patchTestPgliteClose(pgLite: PgLite): () => Promise<void> {
  const actualClose = pgLite.close.bind(pgLite);

  pgLite.close = async () => {};

  return actualClose;
}

async function createTestDb(): Promise<void> {
  const state = getTestDbState();
  const { PGlite } = await import('@electric-sql/pglite');
  const pgLite = new PGlite();

  if (!state.schemaApplied) {
    const schemaSql = prepareSchemaForPgLite(await getSql('tables', 'tables'));
    await pgLite.exec(schemaSql);
    state.schemaApplied = true;
  }

  const pgLiteClient: DbClient = {
    async query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      const result = await pgLite.query<T>(text, params ?? []);
      return {
        rows: result.rows,
        rowCount: result.affectedRows ?? result.rows.length,
        command: '',
        oid: 0,
        fields: [],
      };
    },
    close: () => pgLite.close(),
  };

  state.client = pgLiteClient;
  state.pgLite = pgLite;
  state.actualClose = patchTestPgliteClose(pgLite);
  client = pgLiteClient;
}

export async function initDb(): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    const state = getTestDbState();

    if (state.client && state.pgLite) {
      client = state.client;
      return;
    }

    if (state.initPromise) {
      await state.initPromise;
      client = state.client;
      return;
    }

    state.initPromise = createTestDb();

    try {
      await state.initPromise;
    } finally {
      state.initPromise = undefined;
    }

    client = state.client;
    return;
  }

  if (!pool) {
    pool = createPgPool();
  }

  client = pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  if (!client) {
    await initDb();
  }

  return client!.query<T>(text, params);
}

export async function resetDb(): Promise<void> {
  await initDb();

  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetDb() is test-only.');
  }

  const state = getTestDbState();
  if (!state.pgLite) {
    throw new Error('Test DB not initialized');
  }

  const tables = [
    'character_inventory_field',
    'character_inventory',
    'character_custom_field',
    'character_stat_field',
    'player_server_link',
    'player',
    'character',
    'stat_template',
    'game',
    'thread_bumps',
    'entitlements_cache',
    'gifted_guilds',
  ]
    .map((name) => `"${name}"`)
    .join(', ');

  await state.pgLite.exec(`TRUNCATE ${tables} RESTART IDENTITY CASCADE;`);
}

export async function closeDb(options?: { force?: boolean }): Promise<void> {
  const force = options?.force ?? process.env.NODE_ENV !== 'test';

  if (process.env.NODE_ENV === 'test') {
    const state = getTestDbState();

    if (!force) return;

    if (state.actualClose) {
      await state.actualClose();
    }

    state.client = undefined;
    state.pgLite = undefined;
    state.actualClose = undefined;
    state.initPromise = undefined;
    state.schemaApplied = false;
    client = undefined;
    return;
  }

  if (pool) {
    await pool.end();
    pool = undefined;
    client = undefined;
  }
}
