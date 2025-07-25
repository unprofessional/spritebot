// src/dao/character_inventory.dao.ts

import { Pool } from 'pg';
import { pgHost, pgPort, pgUser, pgPass, pgDb } from '../config/env_config';

const pool = new Pool({
  user: pgUser,
  host: pgHost,
  database: pgDb,
  password: pgPass,
  port: Number(pgPort),
});

interface InventoryItemInput {
  characterId: string;
  name: string;
  type?: string | null;
  description?: string | null;
  equipped?: boolean;
}

export class CharacterInventoryDAO {
  async create({
    characterId,
    name,
    type = null,
    description = null,
    equipped = false,
  }: InventoryItemInput): Promise<Record<string, any>> {
    const sql = `
      INSERT INTO character_inventory (character_id, name, type, description, equipped)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await pool.query(sql, [characterId, name, type, description, equipped]);
    return result.rows[0];
  }

  async findByCharacter(characterId: string): Promise<Record<string, any>[]> {
    const result = await pool.query(
      `SELECT * FROM character_inventory WHERE character_id = $1 ORDER BY name`,
      [characterId],
    );
    return result.rows;
  }

  async deleteByCharacter(characterId: string): Promise<void> {
    await pool.query(`DELETE FROM character_inventory WHERE character_id = $1`, [characterId]);
  }

  async deleteById(itemId: string): Promise<void> {
    await pool.query(`DELETE FROM character_inventory WHERE id = $1`, [itemId]);
  }

  async toggleEquipped(itemId: string, equipped: boolean): Promise<Record<string, any>> {
    const result = await pool.query(
      `UPDATE character_inventory
       SET equipped = $1
       WHERE id = $2
       RETURNING *`,
      [equipped, itemId],
    );
    return result.rows[0];
  }
}
