// src/dao/game.dao.ts

import { Pool } from 'pg';
import { pgHost, pgPort, pgUser, pgPass, pgDb } from '../config/env_config';

const pool = new Pool({
  user: pgUser,
  host: pgHost,
  database: pgDb,
  password: pgPass,
  port: Number(pgPort),
});

interface CreateGameParams {
  name: string;
  description: string;
  created_by: string;
  guild_id?: string | null;
}

interface UpdateGameParams {
  name: string;
  description?: string | null;
}

export class GameDAO {
  async create({
    name,
    description,
    created_by,
    guild_id = null,
  }: CreateGameParams): Promise<Record<string, any>> {
    const sql = `
      INSERT INTO game (name, description, created_by, guild_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const params = [name, description, created_by.trim(), guild_id?.trim() ?? null];
    const result = await pool.query(sql, params);
    return result.rows[0];
  }

  async update(
    gameId: string,
    { name, description }: UpdateGameParams,
  ): Promise<Record<string, any> | null> {
    const sql = `
      UPDATE game
      SET name = $1,
          description = $2,
          updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `;
    const result = await pool.query(sql, [name.trim(), description?.trim() || null, gameId]);
    return result.rows[0] || null;
  }

  async findById(gameId: string): Promise<Record<string, any> | null> {
    const result = await pool.query(`SELECT * FROM game WHERE id = $1`, [gameId]);
    return result.rows[0] || null;
  }

  async findByUser(userId: string): Promise<Record<string, any>[]> {
    const result = await pool.query(
      `SELECT * FROM game WHERE created_by = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows;
  }

  async findByGuild(guildId: string | null): Promise<Record<string, any>[]> {
    if (!guildId) return [];
    const result = await pool.query(`SELECT * FROM game WHERE guild_id = $1`, [guildId.trim()]);
    return result.rows;
  }

  async findAll(): Promise<Record<string, any>[]> {
    const result = await pool.query(`SELECT * FROM game ORDER BY created_at DESC`);
    return result.rows;
  }

  async delete(gameId: string): Promise<void> {
    await pool.query(`DELETE FROM game WHERE id = $1`, [gameId]);
  }

  async publish(gameId: string): Promise<Record<string, any> | null> {
    const result = await pool.query(`UPDATE game SET is_public = TRUE WHERE id = $1 RETURNING *`, [
      gameId,
    ]);
    return result.rows[0] || null;
  }

  async togglePublish(gameId: string): Promise<Record<string, any> | null> {
    const result = await pool.query(
      `
      UPDATE game
      SET is_public = NOT is_public,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [gameId],
    );
    return result.rows[0] || null;
  }
}
