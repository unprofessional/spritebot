// src/dao/game.dao.ts

import { query } from '../db/client';
import type { Game } from '../types/game';

interface CreateGameParams {
  name: string;
  description: string;
  created_by: string;
  guild_id?: string | null;
}

interface UpdateGameParams {
  name: string;
  description?: string | null;
}

export interface GameCascadeMutation {
  game: Game;
  characterCount: number;
  playerCount: number;
}

type GameCascadeRow = Game & {
  character_count: string | number;
  player_count: string | number;
};

export class GameDAO {
  async create({
    name,
    description,
    created_by,
    guild_id = null,
  }: CreateGameParams): Promise<Game> {
    const sql = `
      INSERT INTO game (name, description, created_by, guild_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const params = [name, description, created_by.trim(), guild_id?.trim() ?? null];
    const result = await query<Game>(sql, params);
    return result.rows[0];
  }

  async update(gameId: string, { name, description }: UpdateGameParams): Promise<Game | null> {
    const sql = `
      UPDATE game
      SET name = $1,
          description = $2,
          updated_at = NOW()
      WHERE id = $3
        AND deleted_at IS NULL
      RETURNING *
    `;
    const result = await query<Game>(sql, [name.trim(), description?.trim() || null, gameId]);
    return result.rows[0] || null;
  }

  async findById(gameId: string): Promise<Game | null> {
    const result = await query<Game>(`SELECT * FROM game WHERE id = $1 AND deleted_at IS NULL`, [
      gameId,
    ]);
    return result.rows[0] || null;
  }

  async findByIdIncludingDeleted(gameId: string): Promise<Game | null> {
    const result = await query<Game>(`SELECT * FROM game WHERE id = $1`, [gameId]);
    return result.rows[0] || null;
  }

  async findByUser(userId: string): Promise<Game[]> {
    const result = await query<Game>(
      `SELECT * FROM game WHERE created_by = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows;
  }

  async findByGuild(guildId: string | null): Promise<Game[]> {
    if (!guildId) return [];
    const result = await query<Game>(
      `SELECT * FROM game WHERE guild_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [guildId.trim()],
    );
    return result.rows;
  }

  async findAll(): Promise<Game[]> {
    const result = await query<Game>(
      `SELECT * FROM game WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    );
    return result.rows;
  }

  async findRestorableByUserInGuild(userId: string, guildId: string): Promise<Game[]> {
    const result = await query<Game>(
      `
        SELECT *
        FROM game
        WHERE created_by = $1
          AND guild_id = $2
          AND deleted_at IS NOT NULL
          AND deleted_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
        ORDER BY deleted_at DESC, created_at DESC
      `,
      [userId.trim(), guildId.trim()],
    );
    return result.rows;
  }

  async findExpiredSoftDeletes(days: number): Promise<Game[]> {
    const result = await query<Game>(
      `
        SELECT *
        FROM game
        WHERE deleted_at IS NOT NULL
          AND deleted_at < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')
        ORDER BY deleted_at ASC
      `,
      [days],
    );
    return result.rows;
  }

  async delete(gameId: string): Promise<void> {
    await query(`DELETE FROM game WHERE id = $1`, [gameId]);
  }

  async softDelete(gameId: string): Promise<Game | null> {
    const result = await query<Game>(
      `
        UPDATE game
        SET deleted_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND deleted_at IS NULL
        RETURNING *
      `,
      [gameId],
    );
    return result.rows[0] || null;
  }

  async restore(gameId: string): Promise<Game | null> {
    const result = await query<Game>(
      `
        UPDATE game
        SET deleted_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND deleted_at IS NOT NULL
        RETURNING *
      `,
      [gameId],
    );
    return result.rows[0] || null;
  }

  async softDeleteWithDependencies(
    gameId: string,
    requesterId: string,
  ): Promise<GameCascadeMutation | null> {
    const result = await query<GameCascadeRow>(
      `
        WITH deleted_game AS (
          UPDATE game
          SET deleted_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
            AND created_by = $2
            AND deleted_at IS NULL
          RETURNING *
        ),
        deleted_characters AS (
          UPDATE character c
          SET deleted_at = dg.deleted_at,
              deleted_by_game = TRUE,
              visibility = 'private',
              last_updated_at = dg.deleted_at
          FROM deleted_game dg
          WHERE c.game_id = dg.id
            AND c.deleted_at IS NULL
          RETURNING c.id
        ),
        cleared_players AS (
          UPDATE player_server_link psl
          SET current_game_id = CASE
                WHEN psl.current_game_id = dg.id THEN NULL
                ELSE psl.current_game_id
              END,
              current_character_id = CASE
                WHEN psl.current_game_id = dg.id
                  OR EXISTS (
                  SELECT 1
                  FROM character c
                  WHERE c.id = psl.current_character_id
                    AND c.game_id = dg.id
                ) THEN NULL
                ELSE psl.current_character_id
              END,
              updated_at = CURRENT_TIMESTAMP
          FROM deleted_game dg
          WHERE psl.current_game_id = dg.id
             OR EXISTS (
               SELECT 1
               FROM character c
               WHERE c.id = psl.current_character_id
                 AND c.game_id = dg.id
             )
          RETURNING psl.id
        )
        SELECT dg.*,
               (SELECT COUNT(*) FROM deleted_characters) AS character_count,
               (SELECT COUNT(*) FROM cleared_players) AS player_count
        FROM deleted_game dg
      `,
      [gameId, requesterId.trim()],
    );
    return mapCascadeMutation(result.rows[0]);
  }

  async restoreWithDependencies(
    gameId: string,
    requesterId: string,
  ): Promise<GameCascadeMutation | null> {
    const result = await query<GameCascadeRow>(
      `
        WITH restored_game AS (
          UPDATE game
          SET deleted_at = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
            AND created_by = $2
            AND deleted_at IS NOT NULL
            AND deleted_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
          RETURNING *
        ),
        restored_characters AS (
          UPDATE character c
          SET deleted_at = NULL,
              deleted_by_game = FALSE,
              visibility = 'private',
              last_updated_at = CURRENT_TIMESTAMP
          FROM restored_game rg
          WHERE c.game_id = rg.id
            AND c.deleted_at IS NOT NULL
            AND c.deleted_by_game = TRUE
          RETURNING c.id
        )
        SELECT rg.*,
               (SELECT COUNT(*) FROM restored_characters) AS character_count,
               0 AS player_count
        FROM restored_game rg
      `,
      [gameId, requesterId.trim()],
    );
    return mapCascadeMutation(result.rows[0]);
  }

  async publish(gameId: string): Promise<Game | null> {
    const result = await query<Game>(
      `UPDATE game SET is_public = TRUE WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [gameId],
    );
    return result.rows[0] || null;
  }

  async togglePublish(gameId: string): Promise<Game | null> {
    const result = await query<Game>(
      `
      UPDATE game
      SET is_public = NOT is_public,
          updated_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL
      RETURNING *
      `,
      [gameId],
    );
    return result.rows[0] || null;
  }
}

function mapCascadeMutation(row?: GameCascadeRow): GameCascadeMutation | null {
  if (!row) return null;
  const { character_count, player_count, ...game } = row;
  return {
    game,
    characterCount: Number(character_count),
    playerCount: Number(player_count),
  };
}
