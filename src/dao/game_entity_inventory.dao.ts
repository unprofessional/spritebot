import { query } from '../db/client';
import type { GameEntityInventoryItem } from '../types/game_entity';

interface InventoryItemInput {
  gameEntityId: string;
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

export class GameEntityInventoryDAO {
  async create({
    gameEntityId,
    name,
    type = null,
    description = null,
    quantity = 1,
    equipped = false,
  }: InventoryItemInput): Promise<GameEntityInventoryItem> {
    const result = await query<GameEntityInventoryItem>(
      `
        INSERT INTO game_entity_inventory (
          game_entity_id,
          name,
          type,
          description,
          quantity,
          equipped
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [gameEntityId, name, type, description, quantity, equipped],
    );
    return result.rows[0];
  }

  async findByGameEntity(gameEntityId: string): Promise<GameEntityInventoryItem[]> {
    const result = await query<GameEntityInventoryItem>(
      `SELECT * FROM game_entity_inventory WHERE game_entity_id = $1 ORDER BY name`,
      [gameEntityId],
    );
    return result.rows;
  }

  async findById(itemId: string): Promise<GameEntityInventoryItem | null> {
    const result = await query<GameEntityInventoryItem>(
      `SELECT * FROM game_entity_inventory WHERE id = $1`,
      [itemId],
    );
    return result.rows[0] || null;
  }

  async updateById(
    itemId: string,
    { name, type = null, description = null, quantity = 1 }: InventoryItemUpdateInput,
  ): Promise<GameEntityInventoryItem | null> {
    const result = await query<GameEntityInventoryItem>(
      `
        UPDATE game_entity_inventory
        SET name = $1,
            type = $2,
            description = $3,
            quantity = $4
        WHERE id = $5
        RETURNING *
      `,
      [name, type, description, quantity, itemId],
    );
    return result.rows[0] || null;
  }

  async toggleEquipped(itemId: string, equipped: boolean): Promise<GameEntityInventoryItem | null> {
    const result = await query<GameEntityInventoryItem>(
      `UPDATE game_entity_inventory SET equipped = $1 WHERE id = $2 RETURNING *`,
      [equipped, itemId],
    );
    return result.rows[0] || null;
  }

  async updateQuantity(itemId: string, quantity: number): Promise<GameEntityInventoryItem | null> {
    const result = await query<GameEntityInventoryItem>(
      `UPDATE game_entity_inventory SET quantity = $1 WHERE id = $2 RETURNING *`,
      [quantity, itemId],
    );
    return result.rows[0] || null;
  }

  async deleteByGameEntity(gameEntityId: string): Promise<void> {
    await query(`DELETE FROM game_entity_inventory WHERE game_entity_id = $1`, [gameEntityId]);
  }

  async deleteById(itemId: string): Promise<void> {
    await query(`DELETE FROM game_entity_inventory WHERE id = $1`, [itemId]);
  }
}
