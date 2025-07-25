// src/components/stat_type_selector.ts

import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { build as buildStatModal } from './create_stat_modal';

const id = 'selectStatType';

function build(gameId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${id}:${gameId}`)
    .setPlaceholder('➕ Add a new stat field...')
    .addOptions([
      {
        label: 'Number (ex. Level, EXP, Gold)',
        value: 'number',
        emoji: '🔢',
      },
      {
        label: 'Count (ex. HP, MP — current/max)',
        value: 'count',
        emoji: '🔁',
      },
      {
        label: 'Short Text (one-line)',
        value: 'short',
        emoji: '💬',
      },
      {
        label: 'Paragraph Text (multi-line)',
        value: 'paragraph',
        emoji: '📝',
      },
    ]);

  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select);
}

async function handle(interaction: StringSelectMenuInteraction): Promise<void> {
  const [, gameId] = interaction.customId.split(':');
  const selectedType = interaction.values?.[0];

  console.log('[stat_type_selector.handle] Interaction received:', {
    customId: interaction.customId,
    gameId,
    selectedType,
    rawValues: interaction.values,
  });

  if (!selectedType || !gameId) {
    console.warn('[stat_type_selector.handle] Missing gameId or selectedType:', {
      gameId,
      selectedType,
    });

    await interaction.reply({
      content: '⚠️ Invalid stat type selection.',
      ephemeral: true,
    });
    return;
  }

  console.log('[stat_type_selector.handle] Calling buildStatModal with:', {
    gameId,
    selectedType,
  });

  const modal = buildStatModal(gameId, selectedType);
  await interaction.showModal(modal);
}

export { build, handle, id };
