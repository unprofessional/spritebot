import { query } from '../db/client';

export interface SupportSubscriberMatch {
  guild_id: string;
}

export interface SupportPlayerMatch {
  guild_id: string;
  game_name: string | null;
}

export class SupportVerificationDAO {
  async findSubscriberGuilds(discordId: string): Promise<SupportSubscriberMatch[]> {
    const result = await query<SupportSubscriberMatch>(
      `
        SELECT DISTINCT guild_id
        FROM entitlements_cache
        WHERE status = 'active'
          AND (ends_at IS NULL OR ends_at > NOW())
          AND (
            raw->>'user_id' = $1
            OR raw->>'userId' = $1
          )
        ORDER BY guild_id
      `,
      [discordId],
    );

    return result.rows;
  }

  async findPlayerGuilds(discordId: string): Promise<SupportPlayerMatch[]> {
    const result = await query<SupportPlayerMatch>(
      `
        SELECT DISTINCT psl.guild_id, g.name AS game_name
        FROM player p
        JOIN player_server_link psl ON psl.player_id = p.id
        JOIN game g ON g.id = psl.current_game_id
          AND g.guild_id = psl.guild_id
        WHERE p.discord_id = $1
          AND EXISTS (
            SELECT 1
            FROM entitlements_cache ec
            WHERE ec.guild_id = psl.guild_id
              AND ec.status = 'active'
              AND (ec.ends_at IS NULL OR ec.ends_at > NOW())
          )
        ORDER BY psl.guild_id, g.name
      `,
      [discordId],
    );

    return result.rows;
  }
}
