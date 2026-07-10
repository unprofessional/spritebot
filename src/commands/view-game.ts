// src/commands/view-game.ts

import { SlashCommandBuilder, ChatInputCommandInteraction, CacheType } from 'discord.js';

import { getCurrentGame } from '../services/player.service';
import { getGame, getGamesByGuild, getStatTemplates } from '../services/game.service';
import { build as buildViewGameCard } from '../components/view_game_card';
import { appendNudge, buildNudge } from '../utils/onboarding_nudge';
import type { Game } from '../types/game';
import type { StatTemplate } from '../types/stat_template';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('view-game')
    .setDescription('View your currently active game.'),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    if (!guildId) {
      return await interaction.reply({
        content: '⚠️ You must use this command in a server.',
        ephemeral: true,
      });
    }

    try {
      const currentGameId = await getCurrentGame(userId, guildId);

      if (!currentGameId) {
        const games = await getGamesByGuild(guildId);

        return await interaction.reply({
          content: appendNudge(
            '⚠️ You do not have an active game in this server.',
            buildNudge(
              {
                userId,
                guildId,
                hasGamesInServer: games.length > 0,
              },
              'view-game',
            ),
          ),
          ephemeral: true,
        });
      }

      const game = await getGame({ id: currentGameId });
      if (!game) {
        return await interaction.reply({
          content: '⚠️ Your current game no longer exists.',
          ephemeral: true,
        });
      }

      const statTemplates = (await getStatTemplates(currentGameId)) as StatTemplate[];
      const response = buildViewGameCard(game as Game, statTemplates, userId);
      const nudge = buildNudge(
        {
          userId,
          guildId,
          gameId: currentGameId,
          isGM: game.created_by === userId,
          gameIsPublished: game.is_public,
          hasStatTemplates: statTemplates.length > 0,
        },
        'view-game',
      );

      return await interaction.reply({
        ...response,
        content: appendNudge(response.content, nudge),
        ephemeral: true,
      });
    } catch (err) {
      console.error('Error in /view-game:', err);
      return await interaction.reply({
        content: '❌ Failed to retrieve current game.',
        ephemeral: true,
      });
    }
  },
};
