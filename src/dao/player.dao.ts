// src/dao/player.dao.ts

import { query } from '../db/client';

export interface PlayerRow {
  id: string;
  discord_id: string;
  created_at?: string;
}

export interface PlayerServerLinkRow {
  id: string;
  player_id: string;
  guild_id: string;
  role: 'player' | 'gm';
  current_character_id: string | null;
  current_game_id: string | null;
  created_at?: string;
  updated_at?: string;
}

export class PlayerDAO {
  async findByDiscordId(discordId: string): Promise<PlayerRow | null> {
    const result = await query<PlayerRow>(`SELECT * FROM player WHERE discord_id = $1`, [
      discordId.trim(),
    ]);
    return result.rows[0] || null;
  }

  async createGlobalPlayer(discordId: string): Promise<PlayerRow> {
    const sql = `
      INSERT INTO player (discord_id)
      VALUES ($1)
      ON CONFLICT (discord_id) DO NOTHING
      RETURNING *
    `;
    const result = await query<PlayerRow>(sql, [discordId.trim()]);
    const player = result.rows[0] || (await this.findByDiscordId(discordId));
    if (!player) throw new Error(`Failed to create player: ${discordId}`);
    return player;
  }

  async ensureServerLink(
    discordId: string,
    guildId: string,
    role: string = 'player',
  ): Promise<PlayerServerLinkRow> {
    const player = await this.findByDiscordId(discordId);
    if (!player) throw new Error(`Player not found: ${discordId}`);

    const sql = `
      INSERT INTO player_server_link (player_id, guild_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (player_id, guild_id)
      DO UPDATE SET
        role = CASE
          WHEN player_server_link.role = 'gm' THEN 'gm'
          ELSE EXCLUDED.role
        END,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    const result = await query<PlayerServerLinkRow>(sql, [player.id, guildId, role]);
    return result.rows[0];
  }

  async getServerLink(discordId: string, guildId: string): Promise<PlayerServerLinkRow | null> {
    const player = await this.findByDiscordId(discordId);
    if (!player) return null;

    const result = await query<PlayerServerLinkRow>(
      `SELECT * FROM player_server_link WHERE player_id = $1 AND guild_id = $2`,
      [player.id, guildId],
    );
    return result.rows[0] || null;
  }

  async setCurrentGame(
    discordId: string,
    guildId: string,
    gameId: string,
  ): Promise<PlayerServerLinkRow> {
    const link = await this.getServerLink(discordId, guildId);
    if (!link) throw new Error(`No player-server link found for ${discordId} in guild ${guildId}`);

    const result = await query<PlayerServerLinkRow>(
      `UPDATE player_server_link
       SET current_game_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE player_id = $2 AND guild_id = $3
       RETURNING *`,
      [gameId, link.player_id, guildId],
    );
    return result.rows[0];
  }

  async getCurrentGame(discordId: string, guildId: string): Promise<string | null> {
    const link = await this.getServerLink(discordId, guildId);
    return link?.current_game_id || null;
  }

  async setCurrentCharacter(
    discordId: string,
    guildId: string,
    characterId: string,
  ): Promise<PlayerServerLinkRow> {
    const link = await this.getServerLink(discordId, guildId);
    if (!link) throw new Error(`No player-server link found for ${discordId} in guild ${guildId}`);

    const result = await query<PlayerServerLinkRow>(
      `UPDATE player_server_link
       SET current_character_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE player_id = $2 AND guild_id = $3
       RETURNING *`,
      [characterId, link.player_id, guildId],
    );
    return result.rows[0];
  }

  async getCurrentCharacter(discordId: string, guildId: string): Promise<string | null> {
    const link = await this.getServerLink(discordId, guildId);
    return link?.current_character_id || null;
  }

  async clearCurrentCharacter(characterId: string): Promise<void> {
    await query(
      `
        UPDATE player_server_link
        SET current_character_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE current_character_id = $1
      `,
      [characterId],
    );
  }

  async delete(discordId: string): Promise<void> {
    const player = await this.findByDiscordId(discordId);
    if (!player) return;
    await query(`DELETE FROM player_server_link WHERE player_id = $1`, [player.id]);
    await query(`DELETE FROM player WHERE id = $1`, [player.id]);
  }
}
