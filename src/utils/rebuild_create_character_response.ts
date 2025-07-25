// src/utils/rebuild_create_character_response.ts

import { ActionRowBuilder, type MessageActionRowComponentBuilder } from 'discord.js';

import { CustomField } from 'types/field_input';
import { build as rebuildFieldSelector } from '../components/character_field_selector';
import { build as rebuildEditFieldSelector } from '../components/edit_character_field_selector';
import { build as buildSubmitCharacterButton } from '../components/submit_character_button';
import type { Game } from '../types/game';
import type { StatTemplate } from '../types/stat_template';

/**
 * Truncates long field values for display (max 40 chars).
 */
function summarize(value: string, max = 40): string {
  if (!value) return '';
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/**
 * Constructs the character creation content message.
 */
function buildCreateCharacterMessage(
  game: Game,
  statTemplates: StatTemplate[] = [],
  userFields: CustomField[] = [],
  draftData: Record<string, unknown> = {},
  fieldOptions: { name: string; label: string }[] = [],
): string {
  const lines: string[] = [];

  lines.push(`# 🧬 Create Character for **${game.name}**`);
  if (game.description?.trim()) {
    const desc = game.description.trim().slice(0, 200);
    lines.push(`> ${desc}${game.description.length > 200 ? '…' : ''}`);
  }

  lines.push('');
  const coreFields = ['core:name', 'core:avatar_url', 'core:bio'];
  const filledCoreCount = coreFields.filter((k) => {
    const val = draftData[k];
    return val && val.toString().trim();
  }).length;

  const coreProgress =
    filledCoreCount === coreFields.length ? '✅' : `(${filledCoreCount}/${coreFields.length})`;
  lines.push(`**CORE Fields:** ${coreProgress}`);

  for (const key of coreFields) {
    const value = draftData[key];
    const label = key
      .split(':')[1]
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    if (value && value.toString().trim()) {
      lines.push(`- [CORE] ${label} 🟢 ${summarize(value.toString())}`);
    } else {
      lines.push(`- [CORE] ${label}`);
    }
  }

  lines.push('');

  if (statTemplates.length) {
    const filledGameCount = statTemplates.filter((t) => {
      const fieldKey = `game:${t.id}`;
      if (t.field_type === 'count') {
        const meta = draftData[`meta:${fieldKey}`] as Record<string, any>;
        return meta?.max != null;
      } else {
        const value = draftData[fieldKey];
        return value && value.toString().trim();
      }
    }).length;

    const gameProgress =
      filledGameCount === statTemplates.length
        ? '✅'
        : `(${filledGameCount}/${statTemplates.length})`;
    lines.push(`**GAME Fields:** ${gameProgress}`);

    for (const t of statTemplates) {
      const fieldKey = `game:${t.id}`;
      let filled = false;
      let display = '';

      if (t.field_type === 'count') {
        const meta = draftData[`meta:${fieldKey}`] as Record<string, any>;
        if (meta?.max != null) {
          filled = true;
          display = `${meta.current ?? meta.max} / ${meta.max}`;
        }
      } else {
        const value = draftData[fieldKey];
        if (value && value.toString().trim()) {
          filled = true;
          display = summarize(value.toString());
        }
      }

      lines.push(`- [GAME] ${t.label}${filled ? ` 🟢 ${display}` : ''}`);
    }
  } else {
    lines.push(`🟨 _GM has not defined any game stat fields yet._`);
  }

  if (userFields.length) {
    lines.push('');
    lines.push(`**[USER] Custom Fields:**`);
    for (const f of userFields) {
      const key = `user:${f.name}`;
      const value = draftData[key];
      const label = f.label || f.name;
      if (value && value.toString().trim()) {
        lines.push(`- [USER] ${label} 🟢 ${summarize(value.toString())}`);
      } else {
        lines.push(`- [USER] ${label}`);
      }
    }
  }

  lines.push('');
  if (fieldOptions.length > 0) {
    lines.push(`⚠️ ALL above fields MUST be filled out before you can submit your character!`);
    lines.push('');
    lines.push(`Use the dropdown below to continue filling out the required fields.`);
    lines.push('');
  } else {
    lines.push(`✅ All required fields are filled! You can now submit your character.`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Rebuilds the character creation message with dropdown and buttons.
 */
function rebuildCreateCharacterResponse(
  game: Game,
  statTemplates: StatTemplate[],
  userFields: CustomField[],
  fieldOptions: { name: string; label: string }[],
  draftData: Record<string, unknown> = {},
): {
  content: string;
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  embeds: never[];
} {
  const content = buildCreateCharacterMessage(
    game,
    statTemplates,
    userFields,
    draftData,
    fieldOptions,
  );

  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  if (fieldOptions.length > 0) {
    components.push(rebuildFieldSelector(fieldOptions, statTemplates));
  }

  const allFields: CustomField[] = [
    { name: 'core:name', label: '[CORE] Name' },
    { name: 'core:avatar_url', label: '[CORE] Avatar URL' },
    { name: 'core:bio', label: '[CORE] Bio' },
    ...statTemplates.map((t) => ({
      name: `game:${t.id}`,
      label: `[GAME] ${t.label}`,
      field_type: t.field_type,
    })),
    ...userFields.map((f) => ({
      name: `user:${f.name}`,
      label: `[USER] ${f.label || f.name}`,
    })),
  ];

  const editDropdown = rebuildEditFieldSelector(allFields, draftData);
  if (editDropdown) {
    components.push(editDropdown);
  }

  const submitRow = buildSubmitCharacterButton(fieldOptions.length > 0);
  components.push(submitRow);

  return {
    content,
    components,
    embeds: [],
  };
}

export { rebuildCreateCharacterResponse };
