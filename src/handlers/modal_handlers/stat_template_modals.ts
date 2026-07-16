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
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';

import type { Game } from '../../types/game';
import type { StatTemplate } from '../../types/stat_template';
import { rebuildCreateGameResponse } from '../../utils/rebuild_create_game_response';
import {
  getCountStatDefaults,
  parseCountDefault,
  withDefaultCurrent,
} from '../../utils/count_stat_defaults';

const handle = async (
  interaction: ModalSubmitInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> => {
  const { customId } = interaction;

  if (customId.startsWith('editStatTemplateModal:')) {
    const [, statId] = customId.split(':');

    try {
      const fieldRecord = await getStatTemplateById(statId);
      if (!fieldRecord) {
        await responder.respond({
          content: '❌ Could not find that stat field.',
          ephemeral: true,
        });
        return;
      }

      const label = interaction.fields.getTextInputValue('label')?.trim().toUpperCase();
      let defaultValue = interaction.fields.getTextInputValue('default_value')?.trim() || null;
      const defaultCurrentRaw =
        fieldRecord.field_type === 'count'
          ? interaction.fields.getTextInputValue('default_current')?.trim() || null
          : null;
      const sortOrderRaw = interaction.fields.getTextInputValue('sort_order')?.trim();
      const sortOrder = isNaN(parseInt(sortOrderRaw, 10)) ? 0 : parseInt(sortOrderRaw, 10);

      if (!label) {
        await responder.respond({
          content: '⚠️ Field label is required.',
          ephemeral: true,
        });
        return;
      }

      let meta = fieldRecord.meta;
      if (fieldRecord.field_type === 'count') {
        const defaultMax = parseCountDefault(defaultValue);
        const defaultCurrent = parseCountDefault(defaultCurrentRaw);
        if (
          (defaultValue && defaultMax === null) ||
          (defaultCurrentRaw && defaultCurrent === null)
        ) {
          await responder.respond({
            content: '⚠️ Default MAX and CURRENT values must be non-negative whole numbers.',
            ephemeral: true,
          });
          return;
        }
        if (defaultCurrent !== null && defaultMax === null) {
          await responder.respond({
            content: '⚠️ Set a default MAX value before setting a default CURRENT value.',
            ephemeral: true,
          });
          return;
        }

        defaultValue = defaultMax === null ? null : String(defaultMax);
        meta = withDefaultCurrent(fieldRecord.meta, defaultCurrentRaw ? defaultCurrent : null);
      }

      await updateStatTemplate(statId, {
        label,
        default_value: defaultValue,
        sort_order: sortOrder,
        meta,
      });

      const gameId = fieldRecord?.game_id;

      if (!gameId) {
        await responder.respond({
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

      await responder.respond({
        ...response,
        components: response.components?.map((row) =>
          'toJSON' in row && typeof row.toJSON === 'function'
            ? row.toJSON()
            : (row as unknown as APIActionRowComponent<APITextInputComponent>),
        ),
      });
    } catch (err) {
      console.error('Error in editStatTemplateModal:', err);
      await responder.respond({
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
  const isCount = field?.field_type === 'count';
  const countDefaults = isCount ? getCountStatDefaults(field) : null;

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
        .setLabel(isCount ? 'Default MAX Value (optional)' : 'Default Value (optional)')
        .setStyle(TextInputStyle.Short)
        .setValue(field?.default_value ?? '')
        .setRequired(false),
    ),
    ...(isCount
      ? [
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('default_current')
              .setLabel('Default CURRENT Value (optional)')
              .setStyle(TextInputStyle.Short)
              .setValue(countDefaults?.current?.toString() ?? '')
              .setRequired(false),
          ),
        ]
      : []),
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
