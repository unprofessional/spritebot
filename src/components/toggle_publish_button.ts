// src/components/toggle_publish_button.ts

import { ButtonBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';

import { getStatTemplates, togglePublish } from '../services/game.service';
import { getOrCreatePlayer } from '../services/player.service';
import type { Game } from '../types/game';
import type { StatTemplate } from '../types/stat_template';
import { rebuildCreateGameResponse } from '../utils/rebuild_create_game_response';

const id = 'togglePublishGame';

function build(gameId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${id}:${gameId}`)
    .setLabel('📣 Toggle Visibility')
    .setStyle(ButtonStyle.Success);
}

async function handle(interaction: ButtonInteraction): Promise<void> {
  const [, gameId] = interaction.customId.split(':');

  try {
    const guildId = interaction.guild?.id;
    if (!guildId) throw new Error('Guild ID not available');

    const userId = interaction.user.id;
    const player = await getOrCreatePlayer(userId, guildId);

    if (!player || player.role !== 'gm' || player.current_game_id !== gameId) {
      await interaction.reply({
        content: '⚠️ Only the GM of this game can change its publish status.',
        ephemeral: true,
      });
      return;
    }

    const updatedGame = await togglePublish(gameId);
    if (!updatedGame) throw new Error('Game not found');

    const rawTemplates = await getStatTemplates(gameId);
    const statTemplates = rawTemplates as StatTemplate[];

    const response = rebuildCreateGameResponse(updatedGame as Game, statTemplates);

    // Convert components properly
    await interaction.update({
      ...response,
      components: response.components.map((row) => row.toJSON()),
    });
  } catch (err) {
    console.error('[togglePublishGame] Error:', err);
    await interaction.reply({
      content: '❌ Failed to toggle publish state. Try again later.',
      ephemeral: true,
    });
  }
}

export { build, handle, id };
