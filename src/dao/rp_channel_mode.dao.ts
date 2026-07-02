import { query } from '../db/client';

export interface RpChannelMode {
  guild_id: string;
  channel_id: string;
  is_ic: boolean;
  updated_by: string;
  updated_at: string;
}

export class RpChannelModeDAO {
  async setMode({
    guildId,
    channelId,
    isIc,
    updatedBy,
  }: {
    guildId: string;
    channelId: string;
    isIc: boolean;
    updatedBy: string;
  }): Promise<RpChannelMode> {
    const sql = `
      INSERT INTO rp_channel_mode (guild_id, channel_id, is_ic, updated_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (guild_id, channel_id)
      DO UPDATE SET
        is_ic = EXCLUDED.is_ic,
        updated_by = EXCLUDED.updated_by,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await query<RpChannelMode>(sql, [guildId, channelId, isIc, updatedBy]);
    return result.rows[0];
  }

  async isInCharacter(guildId: string, channelId: string): Promise<boolean> {
    const result = await query<{ is_ic: boolean }>(
      `SELECT is_ic FROM rp_channel_mode WHERE guild_id = $1 AND channel_id = $2`,
      [guildId, channelId],
    );

    return result.rows[0]?.is_ic ?? false;
  }
}
