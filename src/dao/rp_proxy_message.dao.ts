import { query } from '../db/client';

export interface RpProxyMessage {
  proxy_message_id: string;
  guild_id: string;
  channel_id: string;
  user_id: string;
  character_id: string | null;
  webhook_id: string;
  chunk_index: number;
  created_at: string;
  updated_at: string;
}

export class RpProxyMessageDAO {
  async create(input: {
    proxyMessageId: string;
    guildId: string;
    channelId: string;
    userId: string;
    characterId: string | null;
    webhookId: string;
    chunkIndex: number;
  }): Promise<RpProxyMessage> {
    const sql = `
      INSERT INTO rp_proxy_message (
        proxy_message_id,
        guild_id,
        channel_id,
        user_id,
        character_id,
        webhook_id,
        chunk_index
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (proxy_message_id)
      DO UPDATE SET
        guild_id = EXCLUDED.guild_id,
        channel_id = EXCLUDED.channel_id,
        user_id = EXCLUDED.user_id,
        character_id = EXCLUDED.character_id,
        webhook_id = EXCLUDED.webhook_id,
        chunk_index = EXCLUDED.chunk_index,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await query<RpProxyMessage>(sql, [
      input.proxyMessageId,
      input.guildId,
      input.channelId,
      input.userId,
      input.characterId,
      input.webhookId,
      input.chunkIndex,
    ]);
    return result.rows[0];
  }

  async findByMessageId(messageId: string): Promise<RpProxyMessage | null> {
    const result = await query<RpProxyMessage>(
      `SELECT * FROM rp_proxy_message WHERE proxy_message_id = $1`,
      [messageId],
    );

    return result.rows[0] ?? null;
  }

  async touch(messageId: string): Promise<void> {
    await query(
      `UPDATE rp_proxy_message SET updated_at = CURRENT_TIMESTAMP WHERE proxy_message_id = $1`,
      [messageId],
    );
  }

  async delete(messageId: string): Promise<void> {
    await query(`DELETE FROM rp_proxy_message WHERE proxy_message_id = $1`, [messageId]);
  }
}
