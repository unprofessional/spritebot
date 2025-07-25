// src/components/edit_character_field_selector.ts

import {
  ActionRowBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export const id = 'editCharacterFieldDropdown';

interface FieldDescriptor {
  name: string;
  label: string;
  field_type?: string;
}

type DraftData = Record<string, any>;

/**
 * Truncates a string for use in labels or titles.
 */
function truncate(str: string, max: number = 45): string {
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

/**
 * Builds the dropdown for editing completed fields.
 */
export function build(
  allFields: FieldDescriptor[] = [],
  draftData: DraftData = {},
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const filledFields = allFields.filter((f) => {
    if (f.field_type === 'count') {
      const meta = draftData[`meta:${f.name}`];
      return meta?.max != null;
    } else {
      const val = draftData?.[f.name];
      return typeof val === 'string' && val.trim().length > 0;
    }
  });

  if (!filledFields.length) return null;

  const dropdown = new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder('📝 EDIT a completed field')
    .addOptions(
      filledFields.map((f) => ({
        label: f.label,
        value: `${f.name}|${f.label}${f.field_type ? `|${f.field_type}` : ''}`,
      })),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dropdown);
}

/**
 * Handles user interaction with the edit field dropdown.
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

  console.log('[edit_character_field_selector] raw selected value:', selected);

  const [fieldKey, rawLabel, fieldType] = selected.split('|');
  const label = rawLabel || fieldKey;

  if (!fieldKey.includes(':')) {
    console.warn('[edit_character_field_selector] Invalid fieldKey:', fieldKey);
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
