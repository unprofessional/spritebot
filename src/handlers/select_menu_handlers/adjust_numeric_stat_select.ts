import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuInteraction,
} from 'discord.js';

import { getCharacterWithStats } from '../../services/character.service';
import type { CharacterWithStats, CharacterStatWithLabel } from '../../types/character';

export async function handle(interaction: StringSelectMenuInteraction): Promise<void> {
  const { customId, values } = interaction;
  const [selected] = values;
  const [, statId] = selected.split(':');
  const [, characterId] = customId.split(':');

  const character: CharacterWithStats | null = await getCharacterWithStats(characterId);

  if (!character || !Array.isArray(character.stats)) {
    await interaction.update({
      content: '❌ Character or stat not found.',
      embeds: [],
      components: [],
    });
    return;
  }

  const stat: CharacterStatWithLabel | undefined = character.stats.find(
    (s: CharacterStatWithLabel) => s.template_id === statId,
  );

  if (!stat) {
    await interaction.update({
      content: '❌ Stat not found on character.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (customId.startsWith('adjustStatSelect:')) {
    const modal = new ModalBuilder()
      .setCustomId(`adjustStatModal:${characterId}:${statId}`)
      .setTitle('Adjust Stat Value');

    const operatorInput = new TextInputBuilder()
      .setCustomId('deltaOperator')
      .setLabel('Math operator (+, -, *, /)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('+');

    const valueInput = new TextInputBuilder()
      .setCustomId('deltaValue')
      .setLabel('Value to apply with operator')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('Enter a number');

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(operatorInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(valueInput),
    );

    await interaction.showModal(modal);
    return;
  }

  await interaction.reply({
    content: '❌ Unknown stat adjustment selection.',
    ephemeral: true,
  });
}
