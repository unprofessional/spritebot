// src/components/confirm_delete_stat_button.ts

import { ButtonBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';

import {
  deleteStatTemplate,
  getGame,
  getStatTemplateById,
  getStatTemplates,
} from '../services/game.service';

import { rebuildCreateGameResponse } from '../utils/rebuild_create_game_response';
import type { StatTemplate } from '../types/stat_template';
import type { Game } from '../types/game';

const id = 'confirmDeleteStat';

function build(statId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${id}:${statId}`)
    .setLabel('✅ Confirm Delete')
    .setStyle(ButtonStyle.Danger);
}

async function handle(interaction: ButtonInteraction): Promise<void> {
  const [, statId] = interaction.customId.split(':');

  try {
    const stat = await getStatTemplateById(statId);
    if (!stat) {
      await interaction.reply({
        content: '❌ That stat no longer exists.',
        ephemeral: true,
      });
      return;
    }

    await deleteStatTemplate(statId);

    const [rawGame, rawStats] = await Promise.all([
      getGame({ id: stat.game_id }),
      getStatTemplates(stat.game_id),
    ]);

    if (!rawGame) throw new Error('Game not found');
    const game = rawGame as Game;
    const statTemplates = rawStats as StatTemplate[];

    const response = rebuildCreateGameResponse(game, statTemplates);

    await interaction.update({
      ...response,
      components: response.components.map((row) => row.toJSON()),
    });
  } catch (err) {
    console.error('Error confirming stat deletion:', err);
    await interaction.reply({
      content: '❌ Failed to delete stat.',
      ephemeral: true,
    });
  }
}

export { build, handle, id };
