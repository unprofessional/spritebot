export type CustomStatValueTargetType = 'character' | 'entity';

export type CustomStatValueOutcome =
  | 'written'
  | 'unchanged'
  | 'stale'
  | 'conflict'
  | 'invalid'
  | 'target_missing';

export interface CustomStatValueSnapshot {
  value: string | null;
  meta: Record<string, unknown>;
}

export interface ApplyCustomStatValueInput {
  gameId: string;
  targetType: CustomStatValueTargetType;
  targetId: string;
  templateId: string;
  value: string | null;
  meta: Record<string, unknown>;
  integrationKey: string;
  campaignId: string;
  sourceStatKey: string;
  sourceMaxStatKey?: string | null;
  sourceObservedAt: string;
  sourceRevision?: string | null;
  mappingId: string;
  mappingVersion: string;
  writer: string;
  actorDiscordUserId?: string | null;
}

export interface ApplyCustomStatValueResult {
  outcome: CustomStatValueOutcome;
  priorValue: CustomStatValueSnapshot | null;
  newValue: CustomStatValueSnapshot | null;
  provenanceId: string | null;
}

export interface CustomStatValueState {
  targetType: CustomStatValueTargetType;
  targetId: string;
  templateId: string;
  value: string | null;
  meta: Record<string, unknown>;
  provenance: Record<string, unknown>;
}
