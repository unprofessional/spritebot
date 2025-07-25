// src/commands/view-character.ts

import { SlashCommandBuilder, ChatInputCommandInteraction, CacheType } from 'discord.js';

import { getCharactersByUser, getCharacterWithStats } from '../services/character.service';

import { getCurrentGame, getCurrentCharacter } from '../services/player.service';

import { validateGameAccess } from '../utils/validate_game_access';
import { build as buildCharacterCard } from '../components/view_character_card';

import type { CharacterWithStats } from '../types/character';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('view-character')
    .setDescription("View your character's stats for this game's campaign."),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    const userId = interaction.user.id;
    const guildId = interaction.guild?.id;

    if (!guildId) {
      return await interaction.reply({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    try {
      const currentGameId = await getCurrentGame(userId, guildId);

      if (!currentGameId) {
        return await interaction.reply({
          content: '⚠️ No active game found. Use `/switch-game` or `/join-game` to select one.',
          ephemeral: true,
        });
      }

      const allCharacters = await getCharactersByUser(userId, guildId);

      if (!allCharacters.length) {
        return await interaction.reply({
          content: '⚠️ No character found. Use `/create-character` to start one.',
          ephemeral: true,
        });
      }

      const activeCharacterId = await getCurrentCharacter(userId, guildId);
      if (!activeCharacterId) {
        return await interaction.reply({
          content: '⚠️ No active character selected. Use `/switch-character`.',
          ephemeral: true,
        });
      }

      const full = await getCharacterWithStats(activeCharacterId);
      if (!full) {
        return await interaction.reply({
          content: '⚠️ Could not load your active character. Please try `/switch-character`.',
          ephemeral: true,
        });
      }

      const { warning } = await validateGameAccess({
        gameId: full.game_id,
        userId,
      });

      const isSelf = full.id === activeCharacterId;
      const view = buildCharacterCard(full as CharacterWithStats, isSelf);

      await interaction.reply({
        ...view,
        content: warning ?? undefined,
        ephemeral: true,
      });
    } catch (err) {
      console.error('[COMMAND ERROR] /view-character:', err);
      await interaction.reply({
        content: '❌ Failed to retrieve character. Please try again later.',
        ephemeral: true,
      });
    }
  },
};
