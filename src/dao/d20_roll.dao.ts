import { query } from '../db/client';

export interface D20RollRow {
  id: string;
  interaction_id: string;
  result: number;
  user_id: string;
  guild_id: string | null;
  channel_id: string;
  created_at: string;
}

export class D20RollDAO {
  async create({
    interactionId,
    result,
    userId,
    guildId,
    channelId,
  }: {
    interactionId: string;
    result: number;
    userId: string;
    guildId: string | null;
    channelId: string;
  }): Promise<void> {
    await query(
      `
      INSERT INTO d20_roll (interaction_id, result, user_id, guild_id, channel_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (interaction_id) DO NOTHING
      `,
      [interactionId, result, userId, guildId, channelId],
    );
  }
}
