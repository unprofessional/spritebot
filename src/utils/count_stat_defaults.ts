import type { StatTemplate } from '../types/stat_template';

const defaultCurrentKey = 'default_current';

interface CountStatDefaults {
  max: number | null;
  current: number | null;
}

function applyCountStatDefaultsToDraft(
  draftData: Record<string, unknown>,
  templates: StatTemplate[],
): void {
  for (const template of templates) {
    if (template.field_type !== 'count') continue;
    const fieldKey = `game:${template.id}`;
    if (draftData[`meta:${fieldKey}`] !== undefined) continue;

    const defaults = getCountStatDefaults(template);
    if (defaults.max !== null) {
      draftData[fieldKey] = null;
      draftData[`meta:${fieldKey}`] = defaults;
    }
  }
}

function parseCountDefault(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function getCountStatDefaults(
  template: Pick<StatTemplate, 'default_value' | 'meta'>,
): CountStatDefaults {
  const max = parseCountDefault(template.default_value);
  if (max === null) return { max: null, current: null };

  return {
    max,
    current: parseCountDefault(template.meta?.[defaultCurrentKey]) ?? max,
  };
}

function withDefaultCurrent(
  meta: Record<string, unknown> | null | undefined,
  current: number | null,
): Record<string, unknown> {
  const updated = { ...(meta ?? {}) };
  if (current === null) delete updated[defaultCurrentKey];
  else updated[defaultCurrentKey] = current;
  return updated;
}

function formatStatTemplateDefault(template: StatTemplate): string | null {
  if (template.field_type !== 'count') return template.default_value;

  const defaults = getCountStatDefaults(template);
  return defaults.max === null ? null : `${defaults.current} / ${defaults.max}`;
}

export {
  applyCountStatDefaultsToDraft,
  formatStatTemplateDefault,
  getCountStatDefaults,
  parseCountDefault,
  withDefaultCurrent,
};
export type { CountStatDefaults };
