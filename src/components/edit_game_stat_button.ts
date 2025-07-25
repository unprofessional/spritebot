// src/components/edit_game_stat_button.ts

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
} from 'discord.js';

import { getGame, getStatTemplates } from '../services/game.service';
import type { Game } from '../types/game';
import type { StatTemplate } from '../types/stat_template';
import { build as buildEditStatSelectorRow } from './edit_stat_selector';
import { build as buildCancelButton } from './finish_stat_setup_button';

const id = 'editGameStats';

function build(gameId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${id}:${gameId}`)
    .setLabel('🎲 Edit Stat')
    .setStyle(ButtonStyle.Secondary);
}

async function handle(interaction: ButtonInteraction): Promise<void> {
  const [, gameId] = interaction.customId.split(':');

  const game = (await getGame({ id: gameId })) as Game | null;
  const statTemplates = (await getStatTemplates(gameId)) as StatTemplate[];

  if (!game || game.created_by !== interaction.user.id) {
    await interaction.reply({
      content: '⚠️ Only the GM can edit this game.',
      ephemeral: true,
    });
    return;
  }

  if (!statTemplates.length) {
    await interaction.reply({
      content: '⚠️ No stats to edit yet. Use "Define Required Stats" first.',
      ephemeral: true,
    });
    return;
  }

  const selectRow = buildEditStatSelectorRow(gameId, statTemplates);
  const cancelBtn = new ButtonBuilder(buildCancelButton(gameId));

  await interaction.update({
    content: `🎲 Select a field to edit for **${game.name}**`,
    components: [
      selectRow,
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(cancelBtn),
    ],
    embeds: [] as APIEmbed[],
  });
}

export { build, handle, id };
