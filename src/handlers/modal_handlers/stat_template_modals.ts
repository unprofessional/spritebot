// src/handlers/modal_handlers/stat_template_modals.ts

import {
  ActionRowBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  InteractionEditReplyOptions,
  APIActionRowComponent,
  APITextInputComponent,
} from 'discord.js';

import {
  getGame,
  getStatTemplateById,
  getStatTemplates,
  updateStatTemplate,
} from '../../services/game.service';

import type { Game } from '../../types/game';
import type { StatTemplate } from '../../types/stat_template';
import { rebuildCreateGameResponse } from '../../utils/rebuild_create_game_response';

const handle = async (interaction: ModalSubmitInteraction): Promise<void> => {
  const { customId } = interaction;

  if (customId.startsWith('editStatTemplateModal:')) {
    const [, statId] = customId.split(':');

    try {
      const label = interaction.fields.getTextInputValue('label')?.trim().toUpperCase();
      const defaultValue = interaction.fields.getTextInputValue('default_value')?.trim();
      const sortOrderRaw = interaction.fields.getTextInputValue('sort_order')?.trim();
      const sortOrder = isNaN(parseInt(sortOrderRaw, 10)) ? 0 : parseInt(sortOrderRaw, 10);

      if (!label) {
        await interaction.reply({
          content: '⚠️ Field label is required.',
          ephemeral: true,
        });
        return;
      }

      await updateStatTemplate(statId, {
        label,
        default_value: defaultValue,
        sort_order: sortOrder,
      });

      const fieldRecord = await getStatTemplateById(statId);
      const gameId = fieldRecord?.game_id;

      if (!gameId) {
        await interaction.reply({
          content: '❌ Could not determine the game associated with this field.',
          ephemeral: true,
        });
        return;
      }

      const [allFields, game] = await Promise.all([
        getStatTemplates(gameId) as Promise<StatTemplate[]>,
        getGame({ id: gameId }) as Promise<Game>,
      ]);

      const response = rebuildCreateGameResponse(
        game,
        allFields,
        label,
      ) as InteractionEditReplyOptions;

      await interaction.deferUpdate();
      await interaction.editReply({
        ...response,
        components: response.components?.map((row) =>
          'toJSON' in row && typeof row.toJSON === 'function'
            ? row.toJSON()
            : (row as unknown as APIActionRowComponent<APITextInputComponent>),
        ),
      });
    } catch (err) {
      console.error('Error in editStatTemplateModal:', err);
      await interaction.reply({
        content: '❌ Failed to update stat template.',
        ephemeral: true,
      });
    }
  }
};

function buildStatTemplateModal({
  gameId,
  field,
}: {
  gameId: string;
  field?: StatTemplate;
}): ModalBuilder {
  const isEdit = !!field;
  const id = isEdit
    ? `editStatTemplateModal:${field.id}`
    : `createStatModal:${gameId}:${(field as StatTemplate | undefined)?.field_type ?? 'short'}`;

  const title = isEdit ? `Edit Field: ${field.label}` : 'Add New Stat Field';

  const components = [
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('label')
        .setLabel('Field Label (e.g. HP, CLASS, STRENGTH)')
        .setStyle(TextInputStyle.Short)
        .setValue(field?.label ?? '')
        .setRequired(true),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('default_value')
        .setLabel('Default Value (optional)')
        .setStyle(TextInputStyle.Short)
        .setValue(field?.default_value ?? '')
        .setRequired(false),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('sort_order')
        .setLabel('Sort Order (lower = higher up)')
        .setStyle(TextInputStyle.Short)
        .setValue(field?.sort_order?.toString() ?? '0')
        .setRequired(false),
    ),
  ];

  return new ModalBuilder()
    .setCustomId(id)
    .setTitle(title)
    .addComponents(...components);
}

export { buildStatTemplateModal, handle };
