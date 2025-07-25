// src/handlers/select_menu_handlers/character_stat_select_menu.ts

import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';

import { getCharacterWithStats } from '../../services/character.service';
import type { CharacterWithStats, CharacterStatWithLabel } from '../../types/character';

/**
 * Truncates a string to a maximum length with ellipsis if needed.
 */
function truncate(str: string, max = 45): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/**
 * Shows stat or core field edit modal after user selects from dropdown.
 */
export async function handle(interaction: StringSelectMenuInteraction): Promise<void> {
  const { customId, values } = interaction;
  const [, characterId] = customId.split(':');
  const selectedKey = values?.[0];

  if (!selectedKey) {
    console.warn('[editStatSelect] No value received from select menu.');
    await interaction.reply({
      content: '⚠️ No stat selected.',
      ephemeral: true,
    });
    return;
  }

  const character = await getCharacterWithStats(characterId);

  if (!character) {
    await interaction.reply({
      content: '❌ Character not found.',
      ephemeral: true,
    });
    return;
  }

  // === CORE FIELD ===
  if (selectedKey.startsWith('core:')) {
    const [, coreField] = selectedKey.split(':') as [string, keyof CharacterWithStats];
    const value = character[coreField] ?? '';

    const label = coreField.charAt(0).toUpperCase() + coreField.slice(1);
    const inputStyle = coreField === 'bio' ? TextInputStyle.Paragraph : TextInputStyle.Short;

    const modal = new ModalBuilder()
      .setCustomId(`editCharacterField:${characterId}:${selectedKey}|${label}`)
      .setTitle(truncate(`Edit ${label}`))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(selectedKey)
            .setLabel(truncate(`Value for ${label}`))
            .setStyle(inputStyle)
            .setValue(typeof value === 'string' ? value : '')
            .setRequired(true),
        ),
      );

    await interaction.showModal(modal);
    return;
  }

  // === STAT FIELD ===
  const stat: CharacterStatWithLabel | undefined = character.stats.find(
    (s) => s.template_id === selectedKey,
  );

  if (!stat) {
    console.warn('[editStatSelect] Could not find stat for:', selectedKey);
    await interaction.reply({
      content: '❌ Could not find that stat field.',
      ephemeral: true,
    });
    return;
  }

  const label = stat.label || selectedKey;
  const fieldKey = stat.template_id ?? selectedKey;
  const fieldType = stat.field_type ?? (stat.meta?.field_type as string | undefined);

  const modal = new ModalBuilder().setCustomId(
    `editStatModal:${characterId}:${fieldType}:${fieldKey}`,
  );

  modal.setTitle(truncate(`Edit Stat: ${label}`));

  if (fieldType === 'count' || stat.meta?.max !== undefined) {
    const max = stat.meta?.max ?? '';
    const current = stat.meta?.current ?? max;

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`${fieldKey}:max`)
          .setLabel(truncate(`Max value for ${label}`))
          .setStyle(TextInputStyle.Short)
          .setValue(String(max))
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`${fieldKey}:current`)
          .setLabel(truncate(`Current value for ${label}`))
          .setStyle(TextInputStyle.Short)
          .setValue(String(current))
          .setRequired(false),
      ),
    );
  } else {
    const inputStyle = fieldType === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short;

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(fieldKey)
          .setLabel(truncate(`New value for ${label}`))
          .setStyle(inputStyle)
          .setValue(stat.value ?? '')
          .setRequired(true),
      ),
    );
  }

  await interaction.showModal(modal);
}
