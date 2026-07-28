import { GameDAO } from '../dao/game.dao';
import { StatTemplateDAO } from '../dao/stat_template.dao';
import type {
  CreateCustomStatDefinitionParams,
  CustomStatDefinition,
  CustomStatFieldType,
} from '../types/stat_template';
import { isValidCustomStatKey } from '../utils/custom_stat_key';

const gameDAO = new GameDAO();
const statTemplateDAO = new StatTemplateDAO();

export interface CustomStatPresetDefinition {
  stat_key: string;
  label: string;
  field_type: CustomStatFieldType;
  default_value: string | null;
  is_required: boolean;
  sort_order: number;
  meta?: Record<string, unknown>;
}

export interface CustomStatPreset {
  key: string;
  version: number;
  label: string;
  stats: readonly CustomStatPresetDefinition[];
}

export const FFRP_V1_PRESET: CustomStatPreset = {
  key: 'ffrp',
  version: 1,
  label: 'FFRP',
  stats: [
    {
      stat_key: 'hp',
      label: 'HP',
      field_type: 'count',
      default_value: '0',
      is_required: true,
      sort_order: 0,
      meta: { default_current: 0 },
    },
    {
      stat_key: 'fp',
      label: 'FP',
      field_type: 'count',
      default_value: '0',
      is_required: true,
      sort_order: 1,
      meta: { default_current: 0 },
    },
  ],
};

const PRESETS = new Map([[FFRP_V1_PRESET.key, FFRP_V1_PRESET]]);

export function getCustomStatPreset(presetKey: string): CustomStatPreset | null {
  return PRESETS.get(presetKey) ?? null;
}

export async function createCustomStatDefinition(
  input: CreateCustomStatDefinitionParams,
): Promise<CustomStatDefinition> {
  if (!isValidCustomStatKey(input.stat_key)) {
    throw new Error(
      'Stat key must start with a lowercase letter and contain only lowercase letters, numbers, or underscores (64 characters maximum).',
    );
  }
  return statTemplateDAO.create(input);
}

export async function applyCustomStatPreset(
  gameId: string,
  presetKey: string,
): Promise<{
  preset: CustomStatPreset;
  created: CustomStatDefinition[];
  existing: CustomStatDefinition[];
}> {
  const preset = getCustomStatPreset(presetKey);
  if (!preset) throw new Error(`Unknown custom-stat preset: ${presetKey}`);

  const game = await gameDAO.findById(gameId);
  if (!game) throw new Error(`Cannot apply a preset to inactive game ${gameId}`);

  const created: CustomStatDefinition[] = [];
  const existing: CustomStatDefinition[] = [];
  for (const stat of preset.stats) {
    const current = await statTemplateDAO.findByGameAndKey(gameId, stat.stat_key);
    if (current) {
      existing.push(current);
      continue;
    }
    try {
      created.push(await statTemplateDAO.create({ ...stat, game_id: gameId }));
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await statTemplateDAO.findByGameAndKey(gameId, stat.stat_key);
      if (!concurrent) throw error;
      existing.push(concurrent);
    }
  }

  await gameDAO.setPreset(gameId, preset.key, preset.version);
  return { preset, created, existing };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
