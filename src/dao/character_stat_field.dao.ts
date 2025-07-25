// src/dao/character_stat_field.dao.ts

import { Pool } from 'pg';
import { pgDb, pgHost, pgPass, pgPort, pgUser } from '../config/env_config';

const pool = new Pool({
  user: pgUser,
  host: pgHost,
  database: pgDb,
  password: pgPass,
  port: Number(pgPort),
});

export interface StatFieldEntry {
  value: string;
  meta?: Record<string, any>;
}

export class CharacterStatFieldDAO {
  async create(
    characterId: string,
    templateId: string,
    value: string,
    meta: Record<string, any> = {},
  ): Promise<Record<string, any>> {
    const sql = `
      INSERT INTO character_stat_field (character_id, template_id, value, meta)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (character_id, template_id)
      DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta
      RETURNING *
    `;
    const result = await pool.query(sql, [characterId, templateId, value, JSON.stringify(meta)]);
    const row = result.rows[0];

    return {
      ...row,
      meta: typeof row.meta === 'string' ? JSON.parse(row.meta || '{}') : row.meta || {},
    };
  }

  async bulkUpsert(
    characterId: string,
    statMap: Record<string, StatFieldEntry | string> = {},
  ): Promise<Record<string, any>[]> {
    const results: Record<string, any>[] = [];

    for (const [templateId, entry] of Object.entries(statMap)) {
      let value: string;
      let meta: Record<string, any>;

      if (typeof entry === 'object' && entry !== null) {
        value = entry.value ?? '';
        meta = entry.meta ?? {};
      } else {
        value = entry;
        meta = {};
      }

      const updated = await this.create(characterId, templateId, value, meta);
      results.push(updated);
    }

    return results;
  }

  async findByCharacter(
    characterId: string,
  ): Promise<{ template_id: string; value: string; meta: Record<string, any> }[]> {
    const result = await pool.query(
      `SELECT template_id, value, meta FROM character_stat_field WHERE character_id = $1 ORDER BY template_id`,
      [characterId],
    );

    return result.rows.map((row) => ({
      template_id: row.template_id,
      value: row.value,
      meta: typeof row.meta === 'string' ? JSON.parse(row.meta || '{}') : row.meta || {},
    }));
  }

  async deleteByCharacter(characterId: string): Promise<void> {
    await pool.query(`DELETE FROM character_stat_field WHERE character_id = $1`, [characterId]);
  }
}
