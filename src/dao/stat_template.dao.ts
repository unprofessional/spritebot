// src/dao/stat_template.dao.ts

import { Pool } from 'pg';
import { pgDb, pgHost, pgPass, pgPort, pgUser } from '../config/env_config';
import type { CreateStatTemplateParams } from '../types/stat_template';

const pool = new Pool({
  user: pgUser,
  host: pgHost,
  database: pgDb,
  password: pgPass,
  port: Number(pgPort),
});

export class StatTemplateDAO {
  async create({
    game_id,
    label,
    field_type = 'short',
    default_value = null,
    is_required = true,
    sort_order = 0,
    meta = {},
  }: CreateStatTemplateParams): Promise<Record<string, any>> {
    const sql = `
    INSERT INTO stat_template (
      game_id, label, field_type, default_value, is_required, sort_order, meta
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;
    const result = await pool.query(sql, [
      game_id,
      label,
      field_type,
      default_value,
      is_required,
      sort_order,
      JSON.stringify(meta),
    ]);
    return result.rows[0];
  }

  async bulkCreate(gameId: string, templateList: Omit<CreateStatTemplateParams, 'game_id'>[] = []) {
    const created = [];
    for (const tmpl of templateList) {
      const createdTemplate = await this.create({ ...tmpl, game_id: gameId });
      created.push(createdTemplate);
    }
    return created;
  }

  async findById(statId: string): Promise<Record<string, any> | null> {
    const sql = `
      SELECT * FROM stat_template
      WHERE id = $1
      LIMIT 1
    `;
    const result = await pool.query(sql, [statId]);
    return result.rows[0] || null;
  }

  async findByGame(gameId: string): Promise<Record<string, any>[]> {
    const sql = `
      SELECT * FROM stat_template
      WHERE game_id = $1
      ORDER BY sort_order ASC, label ASC
    `;
    const result = await pool.query(sql, [gameId]);
    return result.rows;
  }

  async updateById(
    templateId: string,
    updates: Record<string, any>,
  ): Promise<Record<string, any> | null> {
    const fields: string[] = [];
    const values: any[] = [];
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
      RETURNING *
    `;

    values.push(templateId);
    const result = await pool.query(sql, values);
    return result.rows[0];
  }

  async deleteByGame(gameId: string): Promise<void> {
    await pool.query(`DELETE FROM stat_template WHERE game_id = $1`, [gameId]);
  }

  async deleteById(templateId: string): Promise<void> {
    await pool.query(`DELETE FROM stat_template WHERE id = $1`, [templateId]);
  }
}
