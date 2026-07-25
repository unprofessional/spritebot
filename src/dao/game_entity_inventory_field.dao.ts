import { query } from '../db/client';
import type { GameEntityInventoryField, JsonObject } from '../types/game_entity';

type FieldInput = string | { value?: string; meta?: JsonObject };
type RawGameEntityInventoryField = Omit<GameEntityInventoryField, 'meta'> & {
  meta: JsonObject | string | null;
};

export class GameEntityInventoryFieldDAO {
  async create(
    inventoryId: string,
    name: string,
    value = '',
    meta: JsonObject = {},
  ): Promise<GameEntityInventoryField> {
    const result = await query<RawGameEntityInventoryField>(
      `
        INSERT INTO game_entity_inventory_field (inventory_id, name, value, meta)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (inventory_id, name)
        DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta
        RETURNING *
      `,
      [inventoryId, name.trim(), value, JSON.stringify(meta)],
    );
    return { ...result.rows[0], meta: parseMeta(result.rows[0].meta) };
  }

  async bulkUpsert(
    inventoryId: string,
    fields: Record<string, FieldInput> = {},
  ): Promise<GameEntityInventoryField[]> {
    return Promise.all(
      Object.entries(fields).map(([name, entry]) =>
        this.create(
          inventoryId,
          name,
          typeof entry === 'string' ? entry : (entry.value ?? ''),
          typeof entry === 'string' ? {} : (entry.meta ?? {}),
        ),
      ),
    );
  }

  async findByInventory(inventoryId: string): Promise<GameEntityInventoryField[]> {
    const result = await query<RawGameEntityInventoryField>(
      `SELECT * FROM game_entity_inventory_field WHERE inventory_id = $1 ORDER BY name`,
      [inventoryId],
    );
    return result.rows.map((row) => ({ ...row, meta: parseMeta(row.meta) }));
  }

  async deleteByInventory(inventoryId: string): Promise<void> {
    await query(`DELETE FROM game_entity_inventory_field WHERE inventory_id = $1`, [inventoryId]);
  }

  async deleteById(fieldId: string): Promise<void> {
    await query(`DELETE FROM game_entity_inventory_field WHERE id = $1`, [fieldId]);
  }
}

function parseMeta(meta: JsonObject | string | null): JsonObject {
  if (typeof meta === 'string') return JSON.parse(meta || '{}') as JsonObject;
  return meta ?? {};
}
