// src/dao/player.dao.ts

import { Pool } from 'pg';
import { pgHost, pgPort, pgUser, pgPass, pgDb } from '../config/env_config';

const pool = new Pool({
  user: pgUser,
  host: pgHost,
  database: pgDb,
  password: pgPass,
  port: Number(pgPort),
});

export class PlayerDAO {
  async findByDiscordId(discordId: string): Promise<Record<string, any> | null> {
    const result = await pool.query(`SELECT * FROM player WHERE discord_id = $1`, [
      discordId.trim(),
    ]);
    return result.rows[0] || null;
  }

  async createGlobalPlayer(discordId: string): Promise<Record<string, any>> {
    const sql = `
      INSERT INTO player (discord_id)
      VALUES ($1)
      ON CONFLICT (discord_id) DO NOTHING
      RETURNING *
    `;
    const result = await pool.query(sql, [discordId.trim()]);
    return result.rows[0] || (await this.findByDiscordId(discordId));
  }

  async ensureServerLink(
    discordId: string,
    guildId: string,
    role: string = 'player',
  ): Promise<Record<string, any>> {
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
    const result = await pool.query(sql, [player.id, guildId, role]);
    return result.rows[0];
  }

  async getServerLink(discordId: string, guildId: string): Promise<Record<string, any> | null> {
    const player = await this.findByDiscordId(discordId);
    if (!player) return null;

    const result = await pool.query(
      `SELECT * FROM player_server_link WHERE player_id = $1 AND guild_id = $2`,
      [player.id, guildId],
    );
    return result.rows[0] || null;
  }

  async setCurrentGame(
    discordId: string,
    guildId: string,
    gameId: string,
  ): Promise<Record<string, any>> {
    const link = await this.getServerLink(discordId, guildId);
    if (!link) throw new Error(`No player-server link found for ${discordId} in guild ${guildId}`);

    const result = await pool.query(
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
  ): Promise<Record<string, any>> {
    const link = await this.getServerLink(discordId, guildId);
    if (!link) throw new Error(`No player-server link found for ${discordId} in guild ${guildId}`);

    const result = await pool.query(
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

  async delete(discordId: string): Promise<void> {
    const player = await this.findByDiscordId(discordId);
    if (!player) return;
    await pool.query(`DELETE FROM player_server_link WHERE player_id = $1`, [player.id]);
    await pool.query(`DELETE FROM player WHERE id = $1`, [player.id]);
  }
}
