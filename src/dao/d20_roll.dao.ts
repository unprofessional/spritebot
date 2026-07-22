import { query } from '../db/client';

export interface D20RollRow {
  id: string;
  interaction_id: string;
  result: number;
  created_at: string;
}

export class D20RollDAO {
  async create({
    interactionId,
    result,
  }: {
    interactionId: string;
    result: number;
  }): Promise<void> {
    await query(
      `
      INSERT INTO d20_roll (interaction_id, result)
      VALUES ($1, $2)
      ON CONFLICT (interaction_id) DO NOTHING
      `,
      [interactionId, result],
    );
  }
}
