import { query } from '../db/client';

export interface LifecycleNotificationChannelRow {
  guild_id: string;
  channel_id: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export class LifecycleNotificationChannelDAO {
  async upsert({
    guildId,
    channelId,
    updatedBy,
  }: {
    guildId: string;
    channelId: string;
    updatedBy: string;
  }): Promise<LifecycleNotificationChannelRow> {
    const result = await query<LifecycleNotificationChannelRow>(
      `
      INSERT INTO lifecycle_notification_channel (guild_id, channel_id, updated_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (guild_id)
      DO UPDATE SET
        channel_id = EXCLUDED.channel_id,
        updated_by = EXCLUDED.updated_by,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
      `,
      [guildId, channelId, updatedBy],
    );

    return result.rows[0];
  }

  async clear(guildId: string): Promise<boolean> {
    const result = await query(`DELETE FROM lifecycle_notification_channel WHERE guild_id = $1`, [
      guildId,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async findByGuild(guildId: string): Promise<LifecycleNotificationChannelRow | null> {
    const result = await query<LifecycleNotificationChannelRow>(
      `SELECT * FROM lifecycle_notification_channel WHERE guild_id = $1`,
      [guildId],
    );
    return result.rows[0] ?? null;
  }

  async findAll(): Promise<LifecycleNotificationChannelRow[]> {
    const result = await query<LifecycleNotificationChannelRow>(
      `SELECT * FROM lifecycle_notification_channel ORDER BY guild_id`,
    );
    return result.rows;
  }
}
