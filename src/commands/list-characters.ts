// src/commands/list-characters.ts

import { SlashCommandBuilder, ChatInputCommandInteraction, CacheType } from 'discord.js';

import { getCharactersByGame } from '../services/character.service';
import { getCurrentGame } from '../services/player.service';
import { rebuildListCharactersResponse } from '../components/rebuild_list_characters_response';
import { appendNudge, buildNudge } from '../utils/onboarding_nudge';
import type { Character } from '../types/character';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-characters')
    .setDescription('Lists all public characters in your current game.'),

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
      const gameId = await getCurrentGame(userId, guildId);
      console.log('🧠 [list-characters] gameId:', gameId);

      if (!gameId) {
        return await interaction.reply({
          content: appendNudge(
            '⚠️ You must join or create a game first.',
            buildNudge({ userId, guildId }, 'create-character-no-game'),
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
        return await interaction.reply({
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

      await interaction.reply({
        content,
        components,
        ephemeral: true,
      });
    } catch (err) {
      console.error('[COMMAND ERROR] /list-characters:', err);
      await interaction.reply({
        content: '❌ Failed to list characters. Please try again later.',
        ephemeral: true,
      });
    }
  },
};
