// src/dao/character_inventory.dao.ts

import { query } from '../db/client';

export interface CharacterInventoryRow {
  id: string;
  character_id: string;
  name: string;
  type: string | null;
  quantity: number;
  equipped: boolean;
  description: string | null;
}

interface InventoryItemInput {
  characterId: string;
  name: string;
  type?: string | null;
  description?: string | null;
  quantity?: number;
  equipped?: boolean;
}

interface InventoryItemUpdateInput {
  name: string;
  type?: string | null;
  description?: string | null;
  quantity?: number;
}

export class CharacterInventoryDAO {
  async create({
    characterId,
    name,
    type = null,
    description = null,
    quantity = 1,
    equipped = false,
  }: InventoryItemInput): Promise<CharacterInventoryRow> {
    const sql = `
      INSERT INTO character_inventory (character_id, name, type, description, quantity, equipped)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const result = await query<CharacterInventoryRow>(sql, [
      characterId,
      name,
      type,
      description,
      quantity,
      equipped,
    ]);
    return result.rows[0];
  }

  async findByCharacter(characterId: string): Promise<CharacterInventoryRow[]> {
    const result = await query<CharacterInventoryRow>(
      `SELECT * FROM character_inventory WHERE character_id = $1 ORDER BY name`,
      [characterId],
    );
    return result.rows;
  }

  async findById(itemId: string): Promise<CharacterInventoryRow | null> {
    const result = await query<CharacterInventoryRow>(
      `SELECT * FROM character_inventory WHERE id = $1`,
      [itemId],
    );
    return result.rows[0] || null;
  }

  async updateById(
    itemId: string,
    { name, type = null, description = null, quantity = 1 }: InventoryItemUpdateInput,
  ): Promise<CharacterInventoryRow> {
    const result = await query<CharacterInventoryRow>(
      `UPDATE character_inventory
       SET name = $1,
           type = $2,
           description = $3,
           quantity = $4
       WHERE id = $5
       RETURNING *`,
      [name, type, description, quantity, itemId],
    );
    return result.rows[0];
  }

  async deleteByCharacter(characterId: string): Promise<void> {
    await query(`DELETE FROM character_inventory WHERE character_id = $1`, [characterId]);
  }

  async deleteById(itemId: string): Promise<void> {
    await query(`DELETE FROM character_inventory WHERE id = $1`, [itemId]);
  }

  async toggleEquipped(itemId: string, equipped: boolean): Promise<CharacterInventoryRow> {
    const result = await query<CharacterInventoryRow>(
      `UPDATE character_inventory
       SET equipped = $1
       WHERE id = $2
       RETURNING *`,
      [equipped, itemId],
    );
    return result.rows[0];
  }

  async updateQuantity(itemId: string, quantity: number): Promise<CharacterInventoryRow> {
    const result = await query<CharacterInventoryRow>(
      `UPDATE character_inventory
       SET quantity = $1
       WHERE id = $2
       RETURNING *`,
      [quantity, itemId],
    );
    return result.rows[0];
  }
}
