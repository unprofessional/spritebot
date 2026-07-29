import { query } from '../db/client';
import type {
  CustomStatDefinition,
  CustomStatRegistrationResult,
  RegisterCustomStatDefinitionParams,
} from '../types/stat_template';

export class CustomStatRegistrationDAO {
  async listByGame(gameId: string): Promise<CustomStatDefinition[]> {
    const result = await query<CustomStatDefinition>(
      'SELECT * FROM list_custom_stat_definitions($1)',
      [gameId],
    );
    return result.rows;
  }

  async register(input: RegisterCustomStatDefinitionParams): Promise<CustomStatRegistrationResult> {
    const result = await query<CustomStatRegistrationResult>(
      `SELECT *
       FROM register_custom_stat_definition(
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10
       )`,
      [
        input.game_id,
        input.stat_key,
        input.label,
        input.field_type,
        input.default_value,
        input.is_required,
        input.sort_order,
        JSON.stringify(input.meta),
        input.actor_discord_user_id,
        input.idempotency_key,
      ],
    );

    const registration = result.rows[0];
    if (!registration) {
      throw new Error('Custom-stat registration contract returned no result');
    }
    return registration;
  }
}
