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
      SELECT $1, g.id, $3, $4, $5, $6, $7, $8
      FROM game g
      WHERE g.id = $2
        AND g.deleted_at IS NULL
      RETURNING character.*
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
    const character = result.rows[0];
    if (!character) throw new Error(`Cannot create a character for inactive game ${game_id}`);
    return character;
  }

  async findById(characterId: string): Promise<Character | null> {
    const result = await query<Character>(`SELECT * FROM character WHERE id = $1`, [characterId]);
    return result.rows[0] || null;
  }

  async findActiveById(characterId: string): Promise<Character | null> {
    const result = await query<Character>(
      `
        SELECT c.*
        FROM character c
        JOIN game g ON g.id = c.game_id
        WHERE c.id = $1
          AND c.deleted_at IS NULL
          AND g.deleted_at IS NULL
      `,
      [characterId],
    );
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
            deleted_by_game = FALSE,
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

  async softDeleteWithDependencies(characterId: string): Promise<Character | null> {
    const result = await query<Character>(
      `
        WITH deleted_character AS (
          UPDATE character
          SET deleted_at = CURRENT_TIMESTAMP,
              deleted_by_game = FALSE,
              visibility = 'private',
              last_updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
            AND deleted_at IS NULL
          RETURNING *
        ),
        cleared_players AS (
          UPDATE player_server_link psl
          SET current_character_id = NULL,
              updated_at = CURRENT_TIMESTAMP
          FROM deleted_character dc
          WHERE psl.current_character_id = dc.id
          RETURNING psl.player_id, psl.guild_id
        ),
        cleared_rp_modes AS (
          UPDATE rp_channel_mode rcm
          SET is_ic = FALSE,
              updated_at = CURRENT_TIMESTAMP
          FROM cleared_players cp
          JOIN player p ON p.id = cp.player_id
          WHERE rcm.guild_id = cp.guild_id
            AND rcm.user_id = p.discord_id
            AND rcm.is_ic = TRUE
          RETURNING rcm.channel_id
        )
        SELECT * FROM deleted_character
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
            deleted_by_game = FALSE,
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
