// src/components/join_game_selector.ts

import { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuInteraction } from 'discord.js';

import { getGamesByGuild } from '../services/game.service';
import { getCharactersByUser } from '../services/character.service';
import { getOrCreatePlayer, setCurrentGame } from '../services/player.service';
import { appendNudge, buildNudge } from '../utils/onboarding_nudge';
import type { Game } from '../types/game'; // Adjust the import path/type name as needed
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';

export const id = 'joinGameDropdown';
export const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

/**
 * Builds the joinable game dropdown for public games
 */
export async function build(
  userId: string,
  guildId: string,
): Promise<
  | { content: string; ephemeral: true }
  | { content: string; components: ActionRowBuilder<StringSelectMenuBuilder>[]; ephemeral: true }
> {
  await getOrCreatePlayer(userId, guildId);

  const games = await getGamesByGuild(guildId);

  const eligibleGames = games.filter((game) => game.is_public && game.created_by !== userId);

  if (!eligibleGames.length) {
    const content = [
      '📭 There are no joinable public games in this server right now.',
      '',
      'If you created a game, you’re already considered a player as the **Game Master**.',
    ].join('\n');

    return {
      content: appendNudge(
        content,
        buildNudge({ userId, guildId, hasGamesInServer: games.length > 0 }, 'join-game-empty'),
      ),
      ephemeral: true,
    };
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder('Select a game to join')
    .addOptions(
      eligibleGames.slice(0, 25).map((game: Game) => ({
        label: game.name.slice(0, 100),
        description: game.description?.slice(0, 100) || 'No description',
        value: game.id,
      })),
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

  return {
    content: '🎲 Choose a game you want to join:',
    components: [row],
    ephemeral: true,
  };
}

/**
 * Handles game selection from joinGameDropdown
 */
export async function handle(
  interaction: StringSelectMenuInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const { user, guildId, values } = interaction;
  const selected = values?.[0];

  if (!guildId) {
    await responder.respond({
      content: '⚠️ This action must be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (!selected) {
    await responder.respond({
      content: '⚠️ No game selected.',
      ephemeral: true,
    });
    return;
  }

  try {
    await getOrCreatePlayer(user.id, guildId);
    await setCurrentGame(user.id, guildId, selected);
    const characters = await getCharactersByUser(user.id, guildId);
    const nudge = buildNudge(
      {
        userId: user.id,
        guildId,
        gameId: selected,
        hasCharacters: characters.length > 0,
      },
      'join-game',
    );

    await responder.respond({
      content: appendNudge(`✅ You have joined the selected game.`, nudge),
      components: [],
    });
  } catch (err) {
    console.error('Error joining game:', err);
    await responder.respond({
      content: '❌ Failed to join the selected game.',
      ephemeral: true,
    });
  }
}
