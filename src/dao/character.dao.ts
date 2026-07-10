// src/dao/character.dao.ts

import { query } from '../db/client';
import type { Character } from '../types/character';

interface CharacterMeta {
  name: string;
  avatar_url?: string | null;
  rp_display_name?: string | null;
  rp_display_avatar_url?: string | null;
  bio?: string | null;
  visibility?: 'public' | 'private' | 'link-only';
}

interface CreateCharacterParams extends CharacterMeta {
  user_id: string;
  game_id: string;
}

export class CharacterDAO {
  async create({
    user_id,
    game_id,
    name,
    avatar_url = null,
    rp_display_name = null,
    rp_display_avatar_url = null,
    bio = null,
    visibility = 'private',
  }: CreateCharacterParams): Promise<Character> {
    const sql = `
      INSERT INTO character (
        user_id,
        game_id,
        name,
        avatar_url,
        rp_display_name,
        rp_display_avatar_url,
        bio,
        visibility
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const params = [
      user_id.trim(),
      game_id,
      name,
      avatar_url,
      rp_display_name,
      rp_display_avatar_url,
      bio,
      visibility,
    ];
    const result = await query<Character>(sql, params);
    return result.rows[0];
  }

  async findById(characterId: string): Promise<Character | null> {
    const result = await query<Character>(`SELECT * FROM character WHERE id = $1`, [characterId]);
    return result.rows[0] || null;
  }

  async findByUser(userId: string): Promise<Character[]> {
    const result = await query<Character>(
      `SELECT * FROM character WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId.trim()],
    );
    return result.rows;
  }

  async findByGame(gameId: string): Promise<Character[]> {
    const result = await query<Character>(
      `SELECT * FROM character WHERE game_id = $1 AND deleted_at IS NULL`,
      [gameId],
    );
    return result.rows;
  }

  async findRestorableByUserInGame(userId: string, gameId: string): Promise<Character[]> {
    const result = await query<Character>(
      `
        SELECT *
        FROM character
        WHERE user_id = $1
          AND game_id = $2
          AND deleted_at IS NOT NULL
          AND deleted_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
        ORDER BY deleted_at DESC, created_at DESC
      `,
      [userId.trim(), gameId],
    );
    return result.rows;
  }

  async findAll(): Promise<Character[]> {
    const result = await query<Character>(`SELECT * FROM character ORDER BY created_at DESC`);
    return result.rows;
  }

  async updateMeta(
    characterId: string,
    {
      name,
      avatar_url = null,
      rp_display_name = null,
      rp_display_avatar_url = null,
      bio = null,
      visibility = 'private',
    }: CharacterMeta,
  ): Promise<Character> {
    const sql = `
      UPDATE character
      SET name = $1,
          avatar_url = $2,
          rp_display_name = $3,
          rp_display_avatar_url = $4,
          bio = $5,
          visibility = $6
      WHERE id = $7
      RETURNING *
    `;
    const result = await query<Character>(sql, [
      name,
      avatar_url,
      rp_display_name,
      rp_display_avatar_url,
      bio,
      visibility,
      characterId,
    ]);
    return result.rows[0];
  }

  async delete(characterId: string): Promise<void> {
    await query(`DELETE FROM character WHERE id = $1`, [characterId]);
  }

  async softDelete(characterId: string): Promise<Character | null> {
    const result = await query<Character>(
      `
        UPDATE character
        SET deleted_at = CURRENT_TIMESTAMP,
            visibility = 'private',
            last_updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND deleted_at IS NULL
        RETURNING *
      `,
      [characterId],
    );
    return result.rows[0] || null;
  }

  async restore(characterId: string): Promise<Character | null> {
    const result = await query<Character>(
      `
        UPDATE character
        SET deleted_at = NULL,
            visibility = 'private',
            last_updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND deleted_at IS NOT NULL
        RETURNING *
      `,
      [characterId],
    );
    return result.rows[0] || null;
  }
}
