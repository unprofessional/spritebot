// src/commands/list-games.ts

import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { getGame } from '../services/game.service';
import { getCurrentGame } from '../services/player.service';
import { appendNudge, buildNudge } from '../utils/onboarding_nudge';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-games')
    .setDescription('Lists all games in this server with publish status.'),

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
      const game = await getGame({ guildId });

      if (!game) {
        return await interaction.reply({
          content: appendNudge(
            '📭 No games found in this server.',
            buildNudge({ userId, guildId }, 'list-games-empty'),
          ),
          ephemeral: true,
        });
      }

      const currentGameId = await getCurrentGame(userId, guildId);

      const isGM = game.created_by === userId;
      const visibility = game.is_public ? '✅ Public' : '🔒 Private';
      const creatorTag = isGM ? '🛠️ You are the GM' : '';
      const activeTag = game.id === currentGameId ? '⭐ Active' : '';

      const parts = [`• **${game.name}**`, visibility, creatorTag, activeTag].filter(Boolean);
      const row = parts.join(' — ');
      const nudge = buildNudge(
        {
          userId,
          guildId,
          gameId: currentGameId ?? undefined,
          isGM,
          gameIsPublished: game.is_public,
        },
        'list-games',
      );

      await interaction.reply({
        content: appendNudge(`🎲 **Game in this server:**\n\n${row}`, nudge),
        ephemeral: true,
      });
    } catch (err) {
      console.error('[COMMAND ERROR] /list-games:', err);
      await interaction.reply({
        content: '❌ Failed to list games. Please try again later.',
        ephemeral: true,
      });
    }
  },
};
