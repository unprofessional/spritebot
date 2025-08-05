import { Pool } from 'pg';
import { pgUser, pgPass, pgHost, pgDb, pgPort } from '../config/env_config';

const pool = new Pool({
  user: pgUser,
  host: pgHost,
  database: pgDb,
  password: pgPass,
  port: parseInt(pgPort),
});

export interface BumpThreadRow {
  thread_id: string;
  guild_id: string;
  added_by: string;
  note: string | null;
}

export class ThreadBumpDAO {
  async findAll(): Promise<BumpThreadRow[]> {
    const res = await pool.query<BumpThreadRow>('SELECT * FROM thread_bumps');
    return res.rows;
  }
}
