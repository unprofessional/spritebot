// src/components/delete_stat_selector.ts

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type APIEmbed,
  type MessageActionRowComponentBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { getStatTemplateById } from '../services/game.service';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import type { StatTemplate } from '../types/stat_template';
import { build as buildCancelButton } from './finish_stat_setup_button';

const id = 'deleteStatSelect';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

function build(
  gameId: string,
  statTemplates: StatTemplate[],
): ActionRowBuilder<StringSelectMenuBuilder> {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`${id}:${gameId}`)
    .setPlaceholder('Select a stat field to delete')
    .addOptions(
      statTemplates.map((f, i) => ({
        label: `${i + 1}. ${f.label}`,
        description: `Type: ${f.field_type}`,
        value: f.id,
      })),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
}

async function handle(
  interaction: StringSelectMenuInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const { customId, values } = interaction;
  const selected = values?.[0];
  const [, gameId] = customId.split(':');

  if (!selected) {
    await responder.respond({
      content: '⚠️ No field selected.',
      ephemeral: true,
    });
    return;
  }

  try {
    const field = await getStatTemplateById(selected);
    if (!field || field.game_id !== gameId) {
      await responder.respond({
        content: '❌ Could not find or verify the selected stat field.',
        ephemeral: true,
      });
      return;
    }

    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirmDeleteStat:${selected}`)
        .setLabel('✅ Confirm Delete')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder(buildCancelButton(gameId)),
    );

    await responder.respond({
      content: `🗑️ Are you sure you want to delete stat **${field.label}**?`,
      embeds: [] as APIEmbed[],
      components: [confirmRow as ActionRowBuilder<MessageActionRowComponentBuilder>],
    });
  } catch (err) {
    console.error('Error selecting stat field to delete:', err);
    await responder.respond({
      content: '❌ Failed to prepare delete confirmation.',
      ephemeral: true,
    });
  }
}

export { build, handle, id, interactionPolicy };
