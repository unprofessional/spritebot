// src/components/create_stat_modal.ts

import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ModalSubmitInteraction,
  type ActionRowData,
  type MessageActionRowComponentData,
} from 'discord.js';

import { addStatTemplates, getStatTemplates, getGame } from '../services/game.service';
import { rebuildCreateGameResponse } from '../utils/rebuild_create_game_response';

import type { Game } from '../types/game';
import type { StatTemplate } from '../types/stat_template';

const id = 'createStatModal';

function build(gameId: string, statType: string): ModalBuilder {
  if (!statType) throw new Error('[create_stat_modal.build] Missing statType');

  const labelInput = new TextInputBuilder()
    .setCustomId('label')
    .setLabel("Field Label: What's it called?")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const defaultInput = new TextInputBuilder()
    .setCustomId('default_value')
    .setLabel('Default Value (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const sortInput = new TextInputBuilder()
    .setCustomId('sort_index')
    .setLabel('Sort Order (optional): 0=top, 9=lower')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId(`${id}:${gameId}:${statType}`)
    .setTitle(`Add ${statType.replace('-', ' ')} stat`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(labelInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(defaultInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(sortInput),
    );
}

async function handle(interaction: ModalSubmitInteraction): Promise<void> {
  const [, gameId, statTypeRaw] = interaction.customId.split(':');
  const statType = statTypeRaw as 'number' | 'count' | 'short' | 'paragraph';

  const label = interaction.fields.getTextInputValue('label')?.trim().toUpperCase();
  const defaultValue = interaction.fields.getTextInputValue('default_value')?.trim() || null;
  const sortIndexRaw = interaction.fields.getTextInputValue('sort_index')?.trim();
  const sort_order = sortIndexRaw ? parseInt(sortIndexRaw, 10) : 0;

  if (!label || !['number', 'count', 'short', 'paragraph'].includes(statType)) {
    await interaction.reply({
      content: '⚠️ Invalid input or stat type.',
      ephemeral: true,
    });
    return;
  }

  await addStatTemplates(gameId, [
    {
      label,
      field_type: statType,
      default_value: defaultValue,
      sort_order,
    },
  ]);

  const [game, statTemplates] = await Promise.all([
    getGame({ id: gameId }) as Promise<Game>,
    getStatTemplates(gameId) as Promise<StatTemplate[]>,
  ]);

  const response = rebuildCreateGameResponse(game, statTemplates, label);

  // Update the existing setup message instead of sending a new ephemeral reply
  await interaction.deferUpdate();
  await interaction.editReply({
    content: response.content,
    embeds: response.embeds,
    components: response.components.map((row) =>
      row.toJSON(),
    ) as ActionRowData<MessageActionRowComponentData>[],
  });
}

export { id, build, handle };
