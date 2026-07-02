import { query } from '../db/client';

export interface RpChannelMode {
  guild_id: string;
  channel_id: string;
  user_id: string;
  is_ic: boolean;
  updated_at: string;
}

export class RpChannelModeDAO {
  async setMode({
    guildId,
    channelId,
    userId,
    isIc,
  }: {
    guildId: string;
    channelId: string;
    userId: string;
    isIc: boolean;
  }): Promise<RpChannelMode> {
    const sql = `
      INSERT INTO rp_channel_mode (guild_id, channel_id, user_id, is_ic)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (guild_id, channel_id, user_id)
      DO UPDATE SET
        is_ic = EXCLUDED.is_ic,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await query<RpChannelMode>(sql, [guildId, channelId, userId, isIc]);
    return result.rows[0];
  }

  async isInCharacter(guildId: string, channelId: string, userId: string): Promise<boolean> {
    const result = await query<{ is_ic: boolean }>(
      `SELECT is_ic FROM rp_channel_mode WHERE guild_id = $1 AND channel_id = $2 AND user_id = $3`,
      [guildId, channelId, userId],
    );

    return result.rows[0]?.is_ic ?? false;
  }
}
