import { query } from '../db/client';
import type {
  ApplyCustomStatValueInput,
  ApplyCustomStatValueResult,
  CustomStatValueOutcome,
  CustomStatValueSnapshot,
  CustomStatValueState,
  CustomStatValueTargetType,
} from '../types/custom_stat_value';

interface ApplyRow {
  outcome: CustomStatValueOutcome;
  prior_value: CustomStatValueSnapshot | string | null;
  new_value: CustomStatValueSnapshot | string | null;
  provenance_id: string | null;
}

interface StateRow {
  target_type: CustomStatValueTargetType;
  target_id: string;
  template_id: string;
  value: string | null;
  meta: Record<string, unknown> | string | null;
  provenance: Record<string, unknown> | string | null;
}

function parseObject<T>(value: T | string | null): T | null {
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value;
}

export class CustomStatValueDAO {
  async apply(input: ApplyCustomStatValueInput): Promise<ApplyCustomStatValueResult> {
    const result = await query<ApplyRow>(
      `SELECT *
       FROM apply_custom_stat_value(
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14, $15, $16
       )`,
      [
        input.gameId,
        input.targetType,
        input.targetId,
        input.templateId,
        input.value,
        JSON.stringify(input.meta),
        input.integrationKey,
        input.campaignId,
        input.sourceStatKey,
        input.sourceMaxStatKey ?? null,
        input.sourceObservedAt,
        input.sourceRevision ?? null,
        input.mappingId,
        input.mappingVersion,
        input.writer,
        input.actorDiscordUserId ?? null,
      ],
    );
    const row = result.rows[0];

    return {
      outcome: row.outcome,
      priorValue: parseObject(row.prior_value),
      newValue: parseObject(row.new_value),
      provenanceId: row.provenance_id,
    };
  }

  async getState(input: {
    gameId: string;
    targetType: CustomStatValueTargetType;
    targetId: string;
    templateId: string;
  }): Promise<CustomStatValueState | null> {
    const result = await query<StateRow>(
      `SELECT *
       FROM get_custom_stat_value_state($1, $2, $3, $4)`,
      [input.gameId, input.targetType, input.targetId, input.templateId],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      targetType: row.target_type,
      targetId: row.target_id,
      templateId: row.template_id,
      value: row.value,
      meta: parseObject(row.meta) ?? {},
      provenance: parseObject(row.provenance) ?? {},
    };
  }
}
