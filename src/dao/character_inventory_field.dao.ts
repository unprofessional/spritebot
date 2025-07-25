// src/dao/character_inventory_field.dao.ts

import { Pool } from 'pg';
import { pgHost, pgPort, pgUser, pgPass, pgDb } from '../config/env_config';

const pool = new Pool({
  user: pgUser,
  host: pgHost,
  database: pgDb,
  password: pgPass,
  port: Number(pgPort),
});

type Meta = Record<string, unknown>;
type FieldInput = string | { value?: string; meta?: Meta };

export class CharacterInventoryFieldDAO {
  async create(
    inventoryId: string,
    name: string,
    value: string = '',
    meta: Meta = {},
  ): Promise<{ name: string; value: string; meta: Meta }> {
    const sql = `
      INSERT INTO character_inventory_field (inventory_id, name, value, meta)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (inventory_id, name)
      DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta
      RETURNING *
    `;
    const result = await pool.query(sql, [inventoryId, name.trim(), value, JSON.stringify(meta)]);
    const row = result.rows[0];
    return {
      name: row.name,
      value: row.value,
      meta: JSON.parse(row.meta || '{}'),
    };
  }

  async bulkUpsert(
    inventoryId: string,
    fieldMap: Record<string, FieldInput> = {},
  ): Promise<{ name: string; value: string; meta: Meta }[]> {
    const results = [];

    for (const [name, entry] of Object.entries(fieldMap)) {
      const value = typeof entry === 'object' && entry !== null ? (entry.value ?? '') : entry;
      const meta = typeof entry === 'object' && entry.meta ? entry.meta : {};
      const updated = await this.create(inventoryId, name, value, meta);
      results.push(updated);
    }

    return results;
  }

  async findByInventory(
    inventoryId: string,
  ): Promise<{ name: string; value: string; meta: Meta }[]> {
    const result = await pool.query(
      `SELECT name, value, meta FROM character_inventory_field WHERE inventory_id = $1 ORDER BY name`,
      [inventoryId],
    );

    return result.rows.map((row) => ({
      name: row.name,
      value: row.value,
      meta: JSON.parse(row.meta || '{}'),
    }));
  }

  async deleteByInventory(inventoryId: string): Promise<void> {
    await pool.query(`DELETE FROM character_inventory_field WHERE inventory_id = $1`, [
      inventoryId,
    ]);
  }

  async deleteById(fieldId: string): Promise<void> {
    await pool.query(`DELETE FROM character_inventory_field WHERE id = $1`, [fieldId]);
  }
}
