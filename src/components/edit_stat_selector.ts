// src/components/edit_stat_selector.ts

import { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuInteraction } from 'discord.js';

import { gatedPreparedComponentModalInteractionPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import { presentPreparedModal } from '../discord/prepared_modal';
import { getStatTemplates } from '../services/game.service';
import { buildStatTemplateModal } from '../handlers/modal_handlers/stat_template_modals';
import type { StatTemplate } from '../types/stat_template';

const id = 'editStatSelect';
const interactionPolicy = gatedPreparedComponentModalInteractionPolicy;

/**
 * Build the select menu row to edit a stat.
 */
function build(
  gameId: string,
  statTemplates: StatTemplate[],
): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = statTemplates.map((f, i) => ({
    label: `${i + 1}. ${f.label}`,
    description: `Type: ${f.field_type} — Default: ${f.default_value || 'None'}`,
    value: f.id,
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`${id}:${gameId}`)
    .setPlaceholder('Select a stat field to edit')
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
}

/**
 * Handle the select interaction for editing stat templates.
 */
async function handle(
  interaction: StringSelectMenuInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const { customId, values } = interaction;
  const selected = values?.[0];

  if (!selected) {
    await responder.respond({
      content: '⚠️ No field selected.',
      ephemeral: true,
    });
    return;
  }

  try {
    const [, gameId] = customId.split(':');
    const statTemplates = (await getStatTemplates(gameId)) as StatTemplate[];
    const field = statTemplates.find((f) => f.id === selected);

    if (!field) {
      await responder.respond({
        content: '❌ Could not find that stat field.',
        ephemeral: true,
      });
      return;
    }

    const modal = buildStatTemplateModal({ gameId, field });
    await presentPreparedModal({ modal, responder, userId: interaction.user.id });
  } catch (err) {
    console.error('[editStatSelect] Error showing modal:', err);
    await responder.respond({
      content: '❌ Failed to show edit modal.',
      ephemeral: true,
    });
  }
}

export { build, handle, id, interactionPolicy };
