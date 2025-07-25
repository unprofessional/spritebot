// src/dao/character_custom_field.dao.ts

import { Pool } from 'pg';
import { FieldInput } from 'types/field_input';
import { pgDb, pgHost, pgPass, pgPort, pgUser } from '../config/env_config';

const pool = new Pool({
  user: pgUser,
  host: pgHost,
  database: pgDb,
  password: pgPass,
  port: Number(pgPort),
});

type Meta = Record<string, unknown>;

export class CharacterCustomFieldDAO {
  async create(
    characterId: string,
    name: string,
    value: string,
    meta: Meta = {},
  ): Promise<{ name: string; value: string; meta: Meta }> {
    const sql = `
      INSERT INTO character_custom_field (character_id, name, value, meta)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (character_id, name)
      DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta
      RETURNING *
    `;
    const result = await pool.query(sql, [characterId, name, value, JSON.stringify(meta)]);
    const row = result.rows[0];
    return {
      ...row,
      meta: typeof row.meta === 'string' ? JSON.parse(row.meta || '{}') : row.meta || {},
    };
  }

  async bulkUpsert(
    characterId: string,
    fields: Record<string, FieldInput> = {},
  ): Promise<{ name: string; value: string; meta: Meta }[]> {
    const results = [];
    for (const [name, entry] of Object.entries(fields)) {
      let value: string, meta: Meta;
      if (typeof entry === 'object' && entry !== null) {
        value = entry.value ?? '';
        meta = entry.meta ?? {};
      } else {
        value = entry;
        meta = {};
      }
      const updated = await this.create(characterId, name, value, meta);
      results.push(updated);
    }
    return results;
  }

  async findByCharacter(
    characterId: string,
  ): Promise<{ name: string; value: string; meta: Meta }[]> {
    const result = await pool.query(
      `SELECT name, value, meta FROM character_custom_field WHERE character_id = $1 ORDER BY name`,
      [characterId],
    );

    return result.rows.map((row) => ({
      name: row.name,
      value: row.value,
      meta: typeof row.meta === 'string' ? JSON.parse(row.meta || '{}') : row.meta || {},
    }));
  }

  async deleteByCharacter(characterId: string): Promise<void> {
    await pool.query(`DELETE FROM character_custom_field WHERE character_id = $1`, [characterId]);
  }
}
