// src/dao/character_stat_field.dao.ts

import { query } from '../db/client';

type JsonObject = Record<string, unknown>;

export interface StatFieldEntry {
  value: string;
  meta?: JsonObject;
}

export interface CharacterStatFieldRow {
  id?: string;
  character_id?: string;
  template_id: string;
  value: string;
  meta: JsonObject;
}

interface RawCharacterStatFieldRow {
  id?: string;
  character_id?: string;
  template_id: string;
  value: string;
  meta: JsonObject | string | null;
}

function parseMeta(meta: JsonObject | string | null | undefined): JsonObject {
  if (typeof meta === 'string') {
    const parsed = JSON.parse(meta || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {};
  }

  return meta ?? {};
}

export class CharacterStatFieldDAO {
  async create(
    characterId: string,
    templateId: string,
    value: string,
    meta: JsonObject = {},
  ): Promise<CharacterStatFieldRow> {
    const sql = `
      INSERT INTO character_stat_field (character_id, template_id, value, meta)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (character_id, template_id)
      DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta
      RETURNING *
    `;
    const result = await query<RawCharacterStatFieldRow>(sql, [
      characterId,
      templateId,
      value,
      JSON.stringify(meta),
    ]);
    const row = result.rows[0];

    return {
      ...row,
      meta: parseMeta(row.meta),
    };
  }

  async bulkUpsert(
    characterId: string,
    statMap: Record<string, StatFieldEntry | string> = {},
  ): Promise<CharacterStatFieldRow[]> {
    const results: CharacterStatFieldRow[] = [];

    for (const [templateId, entry] of Object.entries(statMap)) {
      let value: string;
      let meta: JsonObject;

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
  ): Promise<{ template_id: string; value: string; meta: JsonObject }[]> {
    const result = await query<RawCharacterStatFieldRow>(
      `SELECT template_id, value, meta FROM character_stat_field WHERE character_id = $1 ORDER BY template_id`,
      [characterId],
    );

    return result.rows.map((row) => ({
      template_id: row.template_id,
      value: row.value,
      meta: parseMeta(row.meta),
    }));
  }

  async deleteByCharacter(characterId: string): Promise<void> {
    await query(`DELETE FROM character_stat_field WHERE character_id = $1`, [characterId]);
  }
}
