// src/dao/thread_bump.dao.ts
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
  created_at?: Date;
  updated_at?: Date;
  last_bumped_at?: Date | null;
  interval_minutes: number; // NEW
}

export class ThreadBumpDAO {
  async findAll(): Promise<BumpThreadRow[]> {
    const res = await pool.query<BumpThreadRow>(
      'SELECT * FROM thread_bumps ORDER BY created_at DESC',
    );
    return res.rows;
  }

  async listByGuild(guildId: string): Promise<BumpThreadRow[]> {
    const res = await pool.query<BumpThreadRow>(
      'SELECT * FROM thread_bumps WHERE guild_id = $1 ORDER BY created_at DESC',
      [guildId],
    );
    return res.rows;
  }

  async exists(threadId: string): Promise<boolean> {
    const res = await pool.query('SELECT 1 FROM thread_bumps WHERE thread_id = $1', [threadId]);
    return (res.rowCount ?? 0) > 0;
  }

  async get(threadId: string): Promise<BumpThreadRow | null> {
    const res = await pool.query<BumpThreadRow>('SELECT * FROM thread_bumps WHERE thread_id = $1', [
      threadId,
    ]);
    return res.rows[0] ?? null;
  }

  async insert(row: {
    thread_id: string;
    guild_id: string;
    added_by: string;
    note?: string | null;
    interval_minutes?: number; // NEW
  }): Promise<void> {
    await pool.query(
      `INSERT INTO thread_bumps (thread_id, guild_id, added_by, note, interval_minutes)
       VALUES ($1, $2, $3, $4, COALESCE($5, 10080))
       ON CONFLICT (thread_id) DO UPDATE
         SET note = EXCLUDED.note,
             interval_minutes = EXCLUDED.interval_minutes,
             updated_at = NOW()`,
      [row.thread_id, row.guild_id, row.added_by, row.note ?? null, row.interval_minutes ?? null],
    );
  }

  async delete(threadId: string): Promise<boolean> {
    const res = await pool.query('DELETE FROM thread_bumps WHERE thread_id = $1', [threadId]);
    return (res.rowCount ?? 0) > 0;
  }

  async updateNote(threadId: string, note: string | null): Promise<boolean> {
    const res = await pool.query(
      'UPDATE thread_bumps SET note = $2, updated_at = NOW() WHERE thread_id = $1',
      [threadId, note],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async updateInterval(threadId: string, intervalMinutes: number): Promise<boolean> {
    const res = await pool.query(
      'UPDATE thread_bumps SET interval_minutes = $2, updated_at = NOW() WHERE thread_id = $1',
      [threadId, intervalMinutes],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async touchLastBumped(threadId: string, when: Date): Promise<void> {
    await pool.query(
      'UPDATE thread_bumps SET last_bumped_at = $2, updated_at = NOW() WHERE thread_id = $1',
      [threadId, when.toISOString()],
    );
  }
}
