// src/components/join_game_selector.ts

import { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuInteraction } from 'discord.js';

import { getGame } from '../services/game.service';
import { getOrCreatePlayer, setCurrentGame } from '../services/player.service';
import type { Game } from '../types/game'; // Adjust the import path/type name as needed

export const id = 'joinGameDropdown';

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

  const rawGames = await getGame({ guildId });
  const games: Game[] = Array.isArray(rawGames) ? (rawGames as Game[]) : [];

  const eligibleGames = games.filter((game) => game.is_public && game.created_by !== userId);

  if (!eligibleGames.length) {
    return {
      content: [
        '📭 There are no joinable public games in this server right now.',
        '',
        'If you created a game, you’re already considered a player as the **Game Master**.',
      ].join('\n'),
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

    await interaction.update({
      content: `✅ You have joined the selected game.`,
      components: [],
    });
  } catch (err) {
    console.error('Error joining game:', err);
    await interaction.reply({
      content: '❌ Failed to join the selected game.',
      ephemeral: true,
    });
  }
}
