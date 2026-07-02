// src/components/confirm_delete_character_button.ts

import { ButtonBuilder, ButtonStyle, ButtonInteraction } from 'discord.js';

import { getCharacterWithStats, deleteCharacter } from '../services/character.service';

const id = 'confirmDeleteCharacter';

function build(characterId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${id}:${characterId}`)
    .setLabel('✅ Confirm Delete')
    .setStyle(ButtonStyle.Danger);
}

async function handle(interaction: ButtonInteraction): Promise<void> {
  const { customId, user } = interaction;
  const [, characterId] = customId.split(':');

  try {
    const character = await getCharacterWithStats(characterId);
    if (!character || character.user_id !== user.id) {
      await interaction.reply({
        content: '❌ You do not have permission to delete this character.',
        ephemeral: true,
      });
      return;
    }

    console.log(`🚨 Deleting character ${characterId} on user confirm`);
    await deleteCharacter(characterId);

    await interaction.update({
      content: '🗑️ Character successfully deleted.',
      embeds: [],
      components: [],
    });
  } catch (err) {
    console.error('❌ Failed to delete character:', err);
    await interaction.reply({
      content: '❌ Something went wrong while deleting the character.',
      ephemeral: true,
    });
  }
}

export { id, build, handle };
