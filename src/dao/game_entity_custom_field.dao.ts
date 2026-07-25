import { query } from '../db/client';
import type { GameEntityCustomField, JsonObject } from '../types/game_entity';
import type { FieldInput } from '../types/field_input';

type RawGameEntityCustomField = Omit<GameEntityCustomField, 'meta'> & {
  meta: JsonObject | string | null;
};

export class GameEntityCustomFieldDAO {
  async create(
    gameEntityId: string,
    name: string,
    value: string,
    meta: JsonObject = {},
  ): Promise<GameEntityCustomField> {
    const result = await query<RawGameEntityCustomField>(
      `
        INSERT INTO game_entity_custom_field (game_entity_id, name, value, meta)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (game_entity_id, name)
        DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta
        RETURNING *
      `,
      [gameEntityId, name, value, JSON.stringify(meta)],
    );
    return { ...result.rows[0], meta: parseMeta(result.rows[0].meta) };
  }

  async bulkUpsert(
    gameEntityId: string,
    fields: Record<string, FieldInput> = {},
  ): Promise<GameEntityCustomField[]> {
    return Promise.all(
      Object.entries(fields).map(([name, entry]) =>
        this.create(
          gameEntityId,
          name,
          typeof entry === 'string' ? entry : (entry.value ?? ''),
          typeof entry === 'string' ? {} : (entry.meta ?? {}),
        ),
      ),
    );
  }

  async findByGameEntity(gameEntityId: string): Promise<GameEntityCustomField[]> {
    const result = await query<RawGameEntityCustomField>(
      `SELECT * FROM game_entity_custom_field WHERE game_entity_id = $1 ORDER BY name`,
      [gameEntityId],
    );
    return result.rows.map((row) => ({ ...row, meta: parseMeta(row.meta) }));
  }

  async deleteByGameEntity(gameEntityId: string): Promise<void> {
    await query(`DELETE FROM game_entity_custom_field WHERE game_entity_id = $1`, [gameEntityId]);
  }
}

function parseMeta(meta: JsonObject | string | null): JsonObject {
  if (typeof meta === 'string') return JSON.parse(meta || '{}') as JsonObject;
  return meta ?? {};
}
