// src/dao/stat_template.dao.ts

import { query } from '../db/client';
import type { CreateStatTemplateParams, StatTemplate } from '../types/stat_template';
import { isValidCustomStatKey } from '../utils/custom_stat_key';

type StatTemplateUpdate = Partial<
  Pick<CreateStatTemplateParams, 'label' | 'default_value' | 'is_required' | 'sort_order' | 'meta'>
>;

const EDITABLE_COLUMNS = new Set(['label', 'default_value', 'is_required', 'sort_order', 'meta']);

export class StatTemplateDAO {
  async create({
    game_id,
    stat_key,
    label,
    field_type = 'short',
    default_value = null,
    is_required = true,
    sort_order = 0,
    meta = {},
  }: CreateStatTemplateParams): Promise<StatTemplate> {
    if (!isValidCustomStatKey(stat_key)) {
      throw new Error(
        'Stat key must start with a lowercase letter and contain only lowercase letters, numbers, or underscores (64 characters maximum).',
      );
    }
    const sql = `
    INSERT INTO stat_template (
      game_id, stat_key, label, field_type, default_value, is_required, sort_order, meta
    )
    SELECT g.id, $2, $3, $4, $5, $6, $7, $8
    FROM game g
    WHERE g.id = $1
      AND g.deleted_at IS NULL
    RETURNING stat_template.*
  `;
    const result = await query<StatTemplate>(sql, [
      game_id,
      stat_key,
      label,
      field_type,
      default_value,
      is_required,
      sort_order,
      JSON.stringify(meta),
    ]);
    const template = result.rows[0];
    if (!template) throw new Error(`Cannot add a stat template to inactive game ${game_id}`);
    return template;
  }

  async bulkCreate(
    gameId: string,
    templateList: Omit<CreateStatTemplateParams, 'game_id'>[] = [],
  ): Promise<StatTemplate[]> {
    const created: StatTemplate[] = [];
    for (const tmpl of templateList) {
      const createdTemplate = await this.create({ ...tmpl, game_id: gameId });
      created.push(createdTemplate);
    }
    return created;
  }

  async findById(statId: string): Promise<StatTemplate | null> {
    const sql = `
      SELECT st.* FROM stat_template st
      JOIN game g ON g.id = st.game_id AND g.deleted_at IS NULL
      WHERE st.id = $1
      LIMIT 1
    `;
    const result = await query<StatTemplate>(sql, [statId]);
    return result.rows[0] || null;
  }

  async findByGame(gameId: string): Promise<StatTemplate[]> {
    const sql = `
      SELECT st.* FROM stat_template st
      JOIN game g ON g.id = st.game_id AND g.deleted_at IS NULL
      WHERE st.game_id = $1
      ORDER BY st.sort_order ASC, st.label ASC
    `;
    const result = await query<StatTemplate>(sql, [gameId]);
    return result.rows;
  }

  async findByGameAndKey(gameId: string, statKey: string): Promise<StatTemplate | null> {
    const result = await query<StatTemplate>(
      `
        SELECT st.*
        FROM stat_template st
        JOIN game g ON g.id = st.game_id AND g.deleted_at IS NULL
        WHERE st.game_id = $1
          AND lower(st.stat_key) = lower($2)
        LIMIT 1
      `,
      [gameId, statKey],
    );
    return result.rows[0] || null;
  }

  async updateById(templateId: string, updates: StatTemplateUpdate): Promise<StatTemplate | null> {
    const invalidFields = Object.keys(updates).filter((key) => !EDITABLE_COLUMNS.has(key));
    if (invalidFields.length) {
      throw new Error(`Unsupported stat template update field(s): ${invalidFields.join(', ')}`);
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = $${idx++}`);
      values.push(key === 'meta' ? JSON.stringify(val) : val);
    }

    if (!fields.length) return null;

    const sql = `
      UPDATE stat_template
      SET ${fields.join(', ')}
      WHERE id = $${idx}
        AND EXISTS (
          SELECT 1 FROM game g
          WHERE g.id = stat_template.game_id AND g.deleted_at IS NULL
        )
      RETURNING *
    `;

    values.push(templateId);
    const result = await query<StatTemplate>(sql, values);
    return result.rows[0];
  }

  async deleteByGame(gameId: string): Promise<void> {
    await query(
      `DELETE FROM stat_template
       WHERE game_id = $1
         AND EXISTS (SELECT 1 FROM game g WHERE g.id = $1 AND g.deleted_at IS NULL)`,
      [gameId],
    );
  }

  async deleteById(templateId: string): Promise<void> {
    await query(
      `DELETE FROM stat_template st
       WHERE st.id = $1
         AND EXISTS (
           SELECT 1 FROM game g WHERE g.id = st.game_id AND g.deleted_at IS NULL
         )`,
      [templateId],
    );
  }
}
