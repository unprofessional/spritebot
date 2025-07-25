// src/components/delete_character_button.ts

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction } from 'discord.js';

import { getCharacterWithStats } from '../services/character.service';
import { build as buildConfirmDeleteButton } from './confirm_delete_character_button';

const id = 'deleteCharacter';

function build(characterId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${id}:${characterId}`)
    .setLabel('🗑️ Delete Character')
    .setStyle(ButtonStyle.Danger);
}

async function handle(interaction: ButtonInteraction): Promise<void> {
  const { customId, user } = interaction;
  const [, characterId] = customId.split(':');

  try {
    const character = (await getCharacterWithStats(characterId)) as any;

    if (!character || character.user_id !== user.id) {
      await interaction.reply({
        content: '❌ You do not have permission to delete this character.',
        ephemeral: true,
      });
      return;
    }

    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      buildConfirmDeleteButton(characterId),
      new ButtonBuilder()
        .setCustomId(`goBackToCharacter:${characterId}`)
        .setLabel('↩️ Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.update({
      content: `🗑️ Are you sure you want to permanently delete **${character.name}**?`,
      embeds: [],
      components: [confirmRow],
    });
  } catch (err) {
    console.error('Error preparing delete character confirmation:', err);
    await interaction.reply({
      content: '❌ Something went wrong while preparing to delete this character.',
      ephemeral: true,
    });
  }
}

export { id, build, handle };
