// src/commands/view-character.ts

import { SlashCommandBuilder, ChatInputCommandInteraction, CacheType } from 'discord.js';

import { getCharactersByUser, getCharacterWithStats } from '../services/character.service';

import { getCurrentGame, getCurrentCharacter } from '../services/player.service';
import { isUserInCharacterForChannelScope } from '../services/rp_channel_mode.service';

import { validateGameAccess } from '../utils/validate_game_access';
import { appendNudge, buildNudge } from '../utils/onboarding_nudge';
import { build as buildCharacterCard } from '../components/view_character_card';

import type { CharacterWithStats } from '../types/character';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('view-character')
    .setDescription("View your character's stats for this game's campaign."),

  interactionPolicy: {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  } satisfies InteractionDispatchPolicy,

  async execute(
    interaction: ChatInputCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    const userId = interaction.user.id;
    const guildId = interaction.guild?.id;

    if (!guildId) {
      return await responder.respond({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    try {
      const currentGameId = await getCurrentGame(userId, guildId);

      if (!currentGameId) {
        return await responder.respond({
          content: '⚠️ No active game found. Use `/switch-game` or `/join-game` to select one.',
          ephemeral: true,
        });
      }

      const allCharacters = await getCharactersByUser(userId, guildId);

      if (!allCharacters.length) {
        return await responder.respond({
          content: appendNudge(
            '⚠️ No character found.',
            buildNudge({ userId, guildId, gameId: currentGameId }, 'view-character-none'),
          ),
          ephemeral: true,
        });
      }

      const activeCharacterId = await getCurrentCharacter(userId, guildId);
      if (!activeCharacterId) {
        return await responder.respond({
          content: '⚠️ No active character selected. Use `/switch-character`.',
          ephemeral: true,
        });
      }

      const full = await getCharacterWithStats(activeCharacterId);
      if (!full) {
        return await responder.respond({
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
      const isInCharacter = await isUserInCharacterForChannelScope({
        guildId,
        channelId: interaction.channelId,
        parentChannelId: interaction.channel?.isThread() ? interaction.channel.parentId : null,
        userId,
      });
      const roleplayMode = isInCharacter
        ? '🎭 Roleplay mode: **IN CHARACTER** in this channel.'
        : '💬 Roleplay mode: **OUT OF CHARACTER** in this channel.';

      await responder.respond({
        ...view,
        content: [roleplayMode, warning].filter(Boolean).join('\n'),
        ephemeral: true,
      });
    } catch (err) {
      console.error('[COMMAND ERROR] /view-character:', err);
      await responder.respond({
        content: '❌ Failed to retrieve character. Please try again later.',
        ephemeral: true,
      });
    }
  },
};
