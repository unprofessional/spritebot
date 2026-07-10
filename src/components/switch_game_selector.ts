// src/components/switch_game_selector.ts

import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
} from 'discord.js';

import { getCharactersByUser } from '../services/character.service';
import { getGamesByGuild, getGamesByUser } from '../services/game.service';
import { getCurrentCharacter, getOrCreatePlayer, setCurrentGame } from '../services/player.service';
import { appendNudge, buildNudge } from '../utils/onboarding_nudge';
import { validateGameAccess } from '../utils/validate_game_access';
import type { Game } from '../types/game';

export const id = 'switchGameDropdown';

interface BuildResponse {
  content: string;
  ephemeral: true;
  components?: ActionRowBuilder<StringSelectMenuBuilder>[];
}

/**
 * Builds a dropdown of accessible games in the current server
 */
export async function build(userId: string, guildId: string): Promise<BuildResponse> {
  const [allGames, serverGames] = await Promise.all([
    getGamesByUser(userId, guildId),
    getGamesByGuild(guildId),
  ]);
  const accessibleGames: Game[] = [];

  for (const game of allGames) {
    const { valid } = await validateGameAccess({ gameId: game.id, userId });
    if (valid) accessibleGames.push(game);
  }

  if (!accessibleGames.length) {
    return {
      content: appendNudge(
        '⚠️ You have no accessible games in this server.',
        buildNudge(
          {
            userId,
            guildId,
            hasGamesInServer: serverGames.length > 0,
          },
          'switch-game-empty',
        ),
      ),
      ephemeral: true,
    };
  }

  const options = accessibleGames.map((g) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(g.name.slice(0, 100))
      .setDescription(g.description?.slice(0, 90) || 'No description.')
      .setValue(g.id),
  );

  const menu = new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder('Choose your game')
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

  return {
    content: '🎲 Choose your active game:',
    components: [row],
    ephemeral: true,
  };
}

/**
 * Handles selection from the switchGameDropdown
 */
export async function handle(interaction: StringSelectMenuInteraction): Promise<void> {
  const { user, guildId, values } = interaction;
  const selected = values?.[0];

  if (!guildId) {
    await interaction.reply({
      content: '⚠️ This action must be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (!selected) {
    await interaction.reply({
      content: '⚠️ No game selected.',
      ephemeral: true,
    });
    return;
  }

  try {
    await getOrCreatePlayer(user.id, guildId);
    await setCurrentGame(user.id, guildId, selected);
    const [characters, currentCharacterId] = await Promise.all([
      getCharactersByUser(user.id, guildId),
      getCurrentCharacter(user.id, guildId),
    ]);
    const hasActiveCharacter = characters.some((character) => character.id === currentCharacterId);
    const nudge = buildNudge(
      {
        userId: user.id,
        guildId,
        gameId: selected,
        hasCharacters: characters.length > 0,
        hasActiveCharacter,
      },
      'switch-game',
    );

    await interaction.update({
      content: appendNudge(`✅ You have switched to the selected game.`, nudge),
      components: [],
    });
  } catch (err) {
    console.error('Error switching game:', err);
    await interaction.reply({
      content: '❌ Failed to switch game.',
      ephemeral: true,
    });
  }
}
