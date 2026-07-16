// src/commands/list-characters.ts

import { SlashCommandBuilder, ChatInputCommandInteraction, CacheType } from 'discord.js';

import { getCharactersByGame } from '../services/character.service';
import { getGamesByGuild } from '../services/game.service';
import { getCurrentGame } from '../services/player.service';
import { rebuildListCharactersResponse } from '../components/rebuild_list_characters_response';
import { appendNudge, buildNudge } from '../utils/onboarding_nudge';
import type { Character } from '../types/character';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-characters')
    .setDescription('Lists all public characters in your current game.'),

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
      const gameId = await getCurrentGame(userId, guildId);
      console.log('🧠 [list-characters] gameId:', gameId);

      if (!gameId) {
        const games = await getGamesByGuild(guildId);

        return await responder.respond({
          content: appendNudge(
            '⚠️ You must join or create a game first.',
            buildNudge(
              {
                userId,
                guildId,
                hasGamesInServer: games.length > 0,
              },
              'create-character-no-game',
            ),
          ),
          ephemeral: true,
        });
      }

      const allCharacters = (await getCharactersByGame(gameId)) as Character[];

      console.log(
        '📦 [list-characters] All characters in game:',
        allCharacters.map((c) => ({
          id: c.id,
          name: c.name,
          visibility: c.visibility,
        })),
      );

      const publicCharacters = allCharacters.filter(
        (c): c is Character & { created_at: string; visibility: string } =>
          c.visibility === 'public' && !!c.created_at && !!c.visibility,
      );

      console.log(
        '🔓 [list-characters] Public characters:',
        publicCharacters.map((c) => c.name),
      );

      if (!publicCharacters.length) {
        return await responder.respond({
          content: appendNudge(
            '📭 No public characters found in your current game.',
            buildNudge({ userId, guildId, gameId }, 'list-characters-empty'),
          ),
          ephemeral: true,
        });
      }

      const { content, components } = await rebuildListCharactersResponse(
        publicCharacters,
        0,
        userId,
        guildId,
      );

      await responder.respond({
        content,
        components,
        ephemeral: true,
      });
    } catch (err) {
      console.error('[COMMAND ERROR] /list-characters:', err);
      await responder.respond({
        content: '❌ Failed to list characters. Please try again later.',
        ephemeral: true,
      });
    }
  },
};
