// src/components/character_field_selector.ts

import {
  ActionRowBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import type { StatTemplate } from '../types/stat_template';

export const id = 'createCharacterDropdown';

interface FieldOption {
  name: string;
  label: string;
}

/**
 * Truncates a string for use in labels or titles.
 */
function truncate(str: string, max = 45): string {
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

/**
 * Builds a dropdown menu of unfilled character fields.
 */
export function build(
  fieldOptions: FieldOption[] = [],
  statTemplates: StatTemplate[] = [],
): ActionRowBuilder<StringSelectMenuBuilder> {
  const dropdown = new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder('Choose a character field to define')
    .addOptions(
      fieldOptions.map((f) => {
        const template = statTemplates.find((t) => `game:${t.id}` === f.name);
        const fieldType = template?.field_type;
        return {
          label: f.label,
          value: `${f.name}|${f.label}${fieldType ? `|${fieldType}` : ''}`,
        };
      }),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dropdown);
}

/**
 * Handles user interaction with the character field selection dropdown.
 */
export async function handle(interaction: StringSelectMenuInteraction): Promise<void> {
  const selected = interaction.values?.[0];

  if (!selected) {
    await interaction.reply({
      content: '⚠️ No selection made.',
      ephemeral: true,
    });
    return;
  }

  console.log('[character_field_selector] raw selected value:', selected);

  const [fieldKey, rawLabel, fieldType] = selected.split('|');
  const label = rawLabel || fieldKey;

  if (!fieldKey.includes(':')) {
    console.warn('[character_field_selector] Invalid fieldKey:', fieldKey);
    await interaction.reply({
      content: '⚠️ Invalid field selected. Please run `/create-character` again.',
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`createDraftCharacterField:${fieldKey}|${label}|${fieldType || ''}`)
    .setTitle(truncate(`Enter value for ${label}`));

  if (fieldType === 'count') {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`${fieldKey}:max`)
          .setLabel(truncate(`MAX value for ${label}`))
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`${fieldKey}:current`)
          .setLabel(truncate(`CURRENT (optional)`))
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
      ),
    );
  } else {
    const inputStyle = fieldKey === 'core:bio' ? TextInputStyle.Paragraph : TextInputStyle.Short;

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(fieldKey)
          .setLabel(truncate(`Value for ${label}`))
          .setStyle(inputStyle)
          .setRequired(true),
      ),
    );
  }

  await interaction.showModal(modal);
}
