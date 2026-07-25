import { query } from '../db/client';
import type { GameEntity, GameEntityKind, GameEntityVisibility } from '../types/game_entity';

interface GameEntityMeta {
  name: string;
  avatar_url?: string | null;
  rp_display_name?: string | null;
  rp_display_avatar_url?: string | null;
  bio?: string | null;
  visibility?: GameEntityVisibility;
}

interface CreateGameEntityParams extends GameEntityMeta {
  game_id: string;
  created_by: string;
  kind: GameEntityKind;
}

export class GameEntityDAO {
  async create({
    game_id,
    created_by,
    kind,
    name,
    avatar_url = null,
    rp_display_name = null,
    rp_display_avatar_url = null,
    bio = null,
    visibility = 'private',
  }: CreateGameEntityParams): Promise<GameEntity> {
    const result = await query<GameEntity>(
      `
        INSERT INTO game_entity (
          game_id,
          created_by,
          kind,
          name,
          avatar_url,
          rp_display_name,
          rp_display_avatar_url,
          bio,
          visibility
        )
        SELECT g.id, $2, $3, $4, $5, $6, $7, $8, $9
        FROM game g
        WHERE g.id = $1
          AND g.deleted_at IS NULL
        RETURNING game_entity.*
      `,
      [
        game_id,
        created_by.trim(),
        kind,
        name,
        avatar_url,
        rp_display_name,
        rp_display_avatar_url,
        bio,
        visibility,
      ],
    );
    const entity = result.rows[0];
    if (!entity) throw new Error(`Cannot create a game entity for inactive game ${game_id}`);
    return entity;
  }

  async findById(gameEntityId: string): Promise<GameEntity | null> {
    const result = await query<GameEntity>(`SELECT * FROM game_entity WHERE id = $1`, [
      gameEntityId,
    ]);
    return result.rows[0] || null;
  }

  async findActiveById(gameEntityId: string): Promise<GameEntity | null> {
    const result = await query<GameEntity>(
      `
        SELECT ge.*
        FROM game_entity ge
        JOIN game g ON g.id = ge.game_id
        WHERE ge.id = $1
          AND ge.deleted_at IS NULL
          AND g.deleted_at IS NULL
      `,
      [gameEntityId],
    );
    return result.rows[0] || null;
  }

  async findByGame(gameId: string, kind?: GameEntityKind): Promise<GameEntity[]> {
    const result = await query<GameEntity>(
      `
        SELECT *
        FROM game_entity
        WHERE game_id = $1
          AND deleted_at IS NULL
          AND ($2::text IS NULL OR kind = $2)
        ORDER BY created_at DESC
      `,
      [gameId, kind ?? null],
    );
    return result.rows;
  }

  async findRestorableByGame(gameId: string): Promise<GameEntity[]> {
    const result = await query<GameEntity>(
      `
        SELECT *
        FROM game_entity
        WHERE game_id = $1
          AND deleted_at IS NOT NULL
          AND deleted_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
        ORDER BY deleted_at DESC, created_at DESC
      `,
      [gameId],
    );
    return result.rows;
  }

  async findExpiredSoftDeletes(days: number): Promise<GameEntity[]> {
    const result = await query<GameEntity>(
      `
        SELECT *
        FROM game_entity
        WHERE deleted_at IS NOT NULL
          AND deleted_at < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')
        ORDER BY deleted_at ASC
      `,
      [days],
    );
    return result.rows;
  }

  async updateMeta(
    gameEntityId: string,
    {
      name,
      avatar_url = null,
      rp_display_name = null,
      rp_display_avatar_url = null,
      bio = null,
      visibility = 'private',
    }: GameEntityMeta,
  ): Promise<GameEntity | null> {
    const result = await query<GameEntity>(
      `
        UPDATE game_entity
        SET name = $1,
            avatar_url = $2,
            rp_display_name = $3,
            rp_display_avatar_url = $4,
            bio = $5,
            visibility = $6,
            last_updated_at = CURRENT_TIMESTAMP
        WHERE id = $7
          AND deleted_at IS NULL
        RETURNING *
      `,
      [name, avatar_url, rp_display_name, rp_display_avatar_url, bio, visibility, gameEntityId],
    );
    return result.rows[0] || null;
  }

  async softDelete(gameEntityId: string): Promise<GameEntity | null> {
    const result = await query<GameEntity>(
      `
        UPDATE game_entity
        SET deleted_at = CURRENT_TIMESTAMP,
            deleted_by_game = FALSE,
            visibility = 'private',
            last_updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND deleted_at IS NULL
        RETURNING *
      `,
      [gameEntityId],
    );
    return result.rows[0] || null;
  }

  async restore(gameEntityId: string): Promise<GameEntity | null> {
    const result = await query<GameEntity>(
      `
        UPDATE game_entity
        SET deleted_at = NULL,
            deleted_by_game = FALSE,
            visibility = 'private',
            last_updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND deleted_at IS NOT NULL
        RETURNING *
      `,
      [gameEntityId],
    );
    return result.rows[0] || null;
  }

  async delete(gameEntityId: string): Promise<void> {
    await query(`DELETE FROM game_entity WHERE id = $1`, [gameEntityId]);
  }

  async deleteExpiredSoftDeletes(days: number): Promise<number> {
    const result = await query(
      `
        DELETE FROM game_entity
        WHERE deleted_at IS NOT NULL
          AND deleted_at < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')
        RETURNING id
      `,
      [days],
    );
    return result.rowCount ?? 0;
  }
}
