// src/components/delete_stat_button.ts

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
  type ButtonInteraction,
} from 'discord.js';

import { getGame, getStatTemplates } from '../services/game.service';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import type { Game } from '../types/game';
import type { StatTemplate } from '../types/stat_template';
import { build as buildDeleteStatSelectorRow } from './delete_stat_selector';
import { build as buildCancelButton } from './finish_stat_setup_button';

const id = 'deleteStats';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

function build(gameId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${id}:${gameId}`)
    .setLabel('🗑️ Delete Stat')
    .setStyle(ButtonStyle.Danger);
}

async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [, gameId] = interaction.customId.split(':');

  const game = (await getGame({ id: gameId })) as Game | null;
  const statTemplates = (await getStatTemplates(gameId)) as StatTemplate[];

  if (!game || game.created_by !== interaction.user.id) {
    await responder.respond({
      content: '⚠️ Only the GM can delete stat fields.',
      ephemeral: true,
    });
    return;
  }

  if (!statTemplates.length) {
    await responder.respond({
      content: '⚠️ No stats to delete.',
      ephemeral: true,
    });
    return;
  }

  const selectRow = buildDeleteStatSelectorRow(gameId, statTemplates);
  const cancelBtn = new ButtonBuilder(buildCancelButton(gameId));

  await responder.respond({
    content: `🗑️ Select a stat field to delete from **${game.name}**`,
    components: [selectRow, new ActionRowBuilder<ButtonBuilder>().addComponents(cancelBtn)],
    embeds: [] as APIEmbed[],
  });
}

export { build, handle, id, interactionPolicy };
