import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ModalSubmitInteraction,
  type ActionRowData,
  type MessageActionRowComponentData,
} from 'discord.js';
import { discordCustomId } from '../utils/discord_custom_id';
// src/components/create_stat_modal.ts

import { addStatTemplates, getStatTemplates, getGame } from '../services/game.service';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import { appendNudge, buildNudge } from '../utils/onboarding_nudge';
import { parseCountDefault, withDefaultCurrent } from '../utils/count_stat_defaults';
import { rebuildCreateGameResponse } from '../utils/rebuild_create_game_response';
import { isValidCustomStatKey } from '../utils/custom_stat_key';

import type { Game } from '../types/game';
import type { StatTemplate } from '../types/stat_template';

const id = 'createStatModal';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

function build(gameId: string, statType: string): ModalBuilder {
  if (!statType) throw new Error('[create_stat_modal.build] Missing statType');

  const labelInput = new TextInputBuilder()
    .setCustomId(discordCustomId('label'))
    .setLabel("Field Label: What's it called?")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const keyInput = new TextInputBuilder()
    .setCustomId(discordCustomId('stat_key'))
    .setLabel('Stable Key (e.g. hp, stress, ammo)')
    .setPlaceholder('lowercase_letters_numbers_only')
    .setMaxLength(64)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const defaultInput = new TextInputBuilder()
    .setCustomId(discordCustomId('default_value'))
    .setLabel(statType === 'count' ? 'Default MAX Value (optional)' : 'Default Value (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const defaultCurrentInput =
    statType === 'count'
      ? new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(discordCustomId('default_current'))
            .setLabel('Default CURRENT Value (optional)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false),
        )
      : null;

  const sortInput = new TextInputBuilder()
    .setCustomId(discordCustomId('sort_index'))
    .setLabel('Sort Order (optional): 0=top, 9=lower')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId(discordCustomId(`${id}:${gameId}:${statType}`))
    .setTitle(`Add ${statType.replace('-', ' ')} stat`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(labelInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(keyInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(defaultInput),
      ...(defaultCurrentInput ? [defaultCurrentInput] : []),
      new ActionRowBuilder<TextInputBuilder>().addComponents(sortInput),
    );
}

async function handle(
  interaction: ModalSubmitInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [, gameId, statTypeRaw] = interaction.customId.split(':');
  const statType = statTypeRaw as 'number' | 'count' | 'short' | 'paragraph';

  const label = interaction.fields.getTextInputValue('label')?.trim().toUpperCase();
  const statKey = interaction.fields.getTextInputValue('stat_key')?.trim();
  let defaultValue = interaction.fields.getTextInputValue('default_value')?.trim() || null;
  const defaultCurrentRaw =
    statType === 'count'
      ? interaction.fields.getTextInputValue('default_current')?.trim() || null
      : null;
  const sortIndexRaw = interaction.fields.getTextInputValue('sort_index')?.trim();
  const sort_order = sortIndexRaw ? parseInt(sortIndexRaw, 10) : 0;

  if (
    !label ||
    !statKey ||
    !isValidCustomStatKey(statKey) ||
    !['number', 'count', 'short', 'paragraph'].includes(statType)
  ) {
    await responder.respond({
      content:
        '⚠️ Invalid input. The stable key must start with a lowercase letter and use only lowercase letters, numbers, or underscores.',
      ephemeral: true,
    });
    return;
  }

  const game = (await getGame({ id: gameId })) as Game | null;
  if (!game || game.created_by !== interaction.user.id) {
    await responder.respond({
      content: '⚠️ Only the GM can create custom-stat definitions for this game.',
      ephemeral: true,
    });
    return;
  }

  let meta: Record<string, unknown> = {};
  if (statType === 'count') {
    const defaultMax = parseCountDefault(defaultValue);
    const defaultCurrent = parseCountDefault(defaultCurrentRaw);
    if ((defaultValue && defaultMax === null) || (defaultCurrentRaw && defaultCurrent === null)) {
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
    meta = withDefaultCurrent({}, defaultCurrentRaw ? defaultCurrent : null);
  }

  try {
    await addStatTemplates(gameId, [
      {
        stat_key: statKey,
        label,
        field_type: statType,
        default_value: defaultValue,
        sort_order,
        meta,
      },
    ]);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    ) {
      await responder.respond({
        content: `⚠️ This game already has a custom stat with the stable key \`${statKey}\`. Choose a different key.`,
        ephemeral: true,
      });
      return;
    }
    throw error;
  }

  const statTemplates = (await getStatTemplates(gameId)) as StatTemplate[];

  const response = rebuildCreateGameResponse(game, statTemplates, label);
  const nudge = buildNudge(
    {
      userId: interaction.user.id,
      guildId: interaction.guildId ?? '',
      gameId,
      isGM: game.created_by === interaction.user.id,
      gameIsPublished: game.is_public,
      hasStatTemplates: statTemplates.length > 0,
    },
    'define-stat',
  );

  // Update the existing setup message instead of sending a new ephemeral reply
  await responder.respond({
    content: appendNudge(response.content, nudge),
    embeds: response.embeds,
    components: response.components.map((row) =>
      row.toJSON(),
    ) as ActionRowData<MessageActionRowComponentData>[],
  });
}

export { id, build, handle, interactionPolicy };
