// src/commands/view-game.ts

import { SlashCommandBuilder, ChatInputCommandInteraction, CacheType } from 'discord.js';

import { getCurrentGame } from '../services/player.service';
import { getGame, getGamesByGuild, getStatTemplates } from '../services/game.service';
import { build as buildViewGameCard } from '../components/view_game_card';
import { appendNudge, buildNudge } from '../utils/onboarding_nudge';
import type { Game } from '../types/game';
import type { StatTemplate } from '../types/stat_template';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('view-game')
    .setDescription('View your currently active game.'),

  interactionPolicy: {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  } satisfies InteractionDispatchPolicy,

  async execute(
    interaction: ChatInputCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    if (!guildId) {
      return await responder.respond({
        content: '⚠️ You must use this command in a server.',
        ephemeral: true,
      });
    }

    try {
      const currentGameId = await getCurrentGame(userId, guildId);

      if (!currentGameId) {
        const games = await getGamesByGuild(guildId);

        return await responder.respond({
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
        return await responder.respond({
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

      return await responder.respond({
        ...response,
        content: appendNudge(response.content, nudge),
        ephemeral: true,
      });
    } catch (err) {
      console.error('Error in /view-game:', err);
      return await responder.respond({
        content: '❌ Failed to retrieve current game.',
        ephemeral: true,
      });
    }
  },
};
