import type { CustomField } from '../types/field_input';
import type { StatTemplate } from '../types/stat_template';

interface CharacterFieldOption {
  name: string;
  label: string;
  field_type?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function buildCharacterFieldOptions(
  statTemplates: StatTemplate[],
  userFields: CustomField[],
): CharacterFieldOption[] {
  return [
    { name: 'core:name', label: '[CORE] Name' },
    { name: 'core:avatar_url', label: '[CORE] Avatar URL' },
    { name: 'core:rp_display_name', label: '[CORE] RP Display Name' },
    { name: 'core:rp_display_avatar_url', label: '[CORE] RP Display Avatar URL' },
    { name: 'core:bio', label: '[CORE] Bio' },
    ...statTemplates.map((template) => ({
      name: `game:${template.id}`,
      label: `[GAME] ${template.label || template.id}`,
      field_type: template.field_type,
    })),
    ...userFields
      .filter((field) => typeof field?.name === 'string')
      .map((field) => ({
        name: `user:${field.name}`,
        label: `[USER] ${field.label || field.name}`,
      })),
  ].filter(
    (field) =>
      field.name.includes(':') && field.name.trim().length > 0 && field.label.trim().length > 0,
  );
}

function isCharacterFieldFilled(
  field: CharacterFieldOption,
  draftData: Record<string, unknown>,
): boolean {
  if (field.field_type === 'count') {
    const meta = draftData[`meta:${field.name}`];
    return isRecord(meta) && meta.max != null;
  }

  const value = draftData[field.name];
  return typeof value === 'string' && value.trim().length > 0;
}

function getUnfilledCharacterFieldOptions(
  fields: CharacterFieldOption[],
  draftData: Record<string, unknown>,
): CharacterFieldOption[] {
  return fields.filter((field) => !isCharacterFieldFilled(field, draftData));
}

export { buildCharacterFieldOptions, getUnfilledCharacterFieldOptions, isCharacterFieldFilled };
export type { CharacterFieldOption };
