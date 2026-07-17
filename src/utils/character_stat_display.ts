import { formatCountStatValue } from './count_stat_defaults';

interface CharacterStatDisplayInput {
  field_type?: string | null;
  value?: unknown;
  meta?: Record<string, unknown> | null;
}

/**
 * Formats a stored or draft character stat value consistently across Discord surfaces.
 */
function formatCharacterStatValue(stat: CharacterStatDisplayInput): string | null {
  if (stat.field_type === 'count') {
    return formatCountStatValue(stat.meta);
  }

  if (stat.value === null || stat.value === undefined) return null;
  const value = String(stat.value).trim();
  return value || null;
}

export { formatCharacterStatValue };
export type { CharacterStatDisplayInput };
