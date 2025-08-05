// src/components/finish_stat_setup_button.ts

import {
  ButtonStyle,
  type ButtonInteraction,
  type APIButtonComponentWithCustomId,
  type ActionRowData,
  type MessageActionRowComponentData,
} from 'discord.js';

import { getGame, getStatTemplates } from '../services/game.service';
import { rebuildCreateGameResponse } from '../utils/rebuild_create_game_response';

import type { Game } from '../types/game';
import type { StatTemplate } from '../types/stat_template';

const id = 'finishStatSetup';

function build(gameId: string): APIButtonComponentWithCustomId {
  return {
    custom_id: `${id}:${gameId}`,
    label: '↩️ Cancel / Go Back',
    style: ButtonStyle.Secondary,
    type: 2,
  };
}

async function handle(interaction: ButtonInteraction): Promise<void> {
  const [, gameId] = interaction.customId.split(':');

  try {
    const [game, stats] = await Promise.all([
      getGame({ id: gameId }) as Promise<Game | null>,
      getStatTemplates(gameId) as Promise<StatTemplate[]>,
    ]);

    if (!game) {
      await interaction.reply({
        content: '❌ Game not found. You may need to recreate it.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferUpdate();

    const result = rebuildCreateGameResponse(game, stats);

    await interaction.editReply({
      content: result.content,
      embeds: result.embeds,
      components: result.components.map((row) =>
        row.toJSON(),
      ) as ActionRowData<MessageActionRowComponentData>[],
    });
  } catch (err) {
    console.error('Error in finishStatSetup:', err);
    await interaction.reply({
      content: '❌ Something went wrong while finalizing your game setup.',
      ephemeral: true,
    });
  }
}

export { id, build, handle };
