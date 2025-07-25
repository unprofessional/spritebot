// src/handlers/button_handlers/fallback_buttons.ts

import { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';

import { getCharactersByUser, getCharacterWithStats } from '../../services/character.service';
import { isActiveCharacter } from '../../utils/is_active_character';
import { build as buildCharacterCard } from '../../components/view_character_card';

export async function handle(interaction: ButtonInteraction): Promise<void> {
  await interaction.reply({
    content: '❌ Unrecognized button interaction.',
    ephemeral: true,
  });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guild?.id;

  if (!guildId) {
    await interaction.reply({
      content: '⚠️ This command must be used in a server.',
      ephemeral: true,
    });
    return;
  }

  try {
    const allCharacters = await getCharactersByUser(userId, guildId);
    const character = allCharacters.find((c) => c.guild_id === guildId) || allCharacters[0];

    if (!character) {
      await interaction.reply({
        content: '⚠️ No character found. Use `/create-character` to start one.',
        ephemeral: true,
      });
      return;
    }

    const full = await getCharacterWithStats(character.id);
    if (!full) {
      await interaction.reply({
        content: '❌ Failed to load character details.',
        ephemeral: true,
      });
      return;
    }

    const isSelf = await isActiveCharacter(userId, guildId, character.id);
    const view = buildCharacterCard(full, isSelf);

    await interaction.reply({
      ...view,
      ephemeral: true,
    });
  } catch (err) {
    console.error('[SLASH COMMAND FALLBACK ERROR]:', err);
    await interaction.reply({
      content: '❌ Failed to load character view.',
      ephemeral: true,
    });
  }
}
