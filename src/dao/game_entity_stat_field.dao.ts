import { query } from '../db/client';
import type { GameEntityStatField, JsonObject } from '../types/game_entity';

type StatFieldInput = string | { value?: string; meta?: JsonObject };
type RawGameEntityStatField = Omit<GameEntityStatField, 'meta'> & {
  meta: JsonObject | string | null;
};

export class GameEntityStatFieldDAO {
  async create(
    gameEntityId: string,
    templateId: string,
    value: string,
    meta: JsonObject = {},
  ): Promise<GameEntityStatField> {
    const result = await query<RawGameEntityStatField>(
      `
        INSERT INTO game_entity_stat_field (game_entity_id, template_id, value, meta)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (game_entity_id, template_id)
        DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta
        RETURNING *
      `,
      [gameEntityId, templateId, value, JSON.stringify(meta)],
    );
    return { ...result.rows[0], meta: parseMeta(result.rows[0].meta) };
  }

  async bulkUpsert(
    gameEntityId: string,
    fields: Record<string, StatFieldInput> = {},
  ): Promise<GameEntityStatField[]> {
    return Promise.all(
      Object.entries(fields).map(([templateId, entry]) =>
        this.create(
          gameEntityId,
          templateId,
          typeof entry === 'string' ? entry : (entry.value ?? ''),
          typeof entry === 'string' ? {} : (entry.meta ?? {}),
        ),
      ),
    );
  }

  async findByGameEntity(gameEntityId: string): Promise<GameEntityStatField[]> {
    const result = await query<RawGameEntityStatField>(
      `SELECT * FROM game_entity_stat_field WHERE game_entity_id = $1 ORDER BY template_id`,
      [gameEntityId],
    );
    return result.rows.map((row) => ({ ...row, meta: parseMeta(row.meta) }));
  }

  async deleteByGameEntity(gameEntityId: string): Promise<void> {
    await query(`DELETE FROM game_entity_stat_field WHERE game_entity_id = $1`, [gameEntityId]);
  }
}

function parseMeta(meta: JsonObject | string | null): JsonObject {
  if (typeof meta === 'string') return JSON.parse(meta || '{}') as JsonObject;
  return meta ?? {};
}
