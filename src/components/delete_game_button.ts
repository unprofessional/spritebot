import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';

import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import { getGameById } from '../services/game.service';
import { build as buildConfirmDeleteGameButton } from './confirm_delete_game_button';

const id = 'deleteGame';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

function build(gameId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${id}:${gameId}`)
    .setLabel('🗑️ Delete Game')
    .setStyle(ButtonStyle.Danger);
}

async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [, gameId] = interaction.customId.split(':');

  try {
    const game = await getGameById(gameId);
    if (!game || game.created_by !== interaction.user.id) {
      await responder.respond({
        content: '❌ You do not have permission to delete this game.',
        ephemeral: true,
      });
      return;
    }

    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      buildConfirmDeleteGameButton(gameId),
      new ButtonBuilder()
        .setCustomId(`cancelDeleteGame:${gameId}`)
        .setLabel('↩️ Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await responder.respond({
      content: [
        `🗑️ Are you sure you want to delete **${game.name}**?`,
        '⚠️ This will delete the game and all its characters. Players will be removed from the game. You have **30 days** to restore it before it is permanently removed. Use `/restore-game` to recover it.',
      ].join('\n'),
      embeds: [],
      components: [confirmRow],
    });
  } catch (error) {
    console.error('Error preparing delete game confirmation:', error);
    await responder.respond({
      content: '❌ Something went wrong while preparing to delete this game.',
      ephemeral: true,
    });
  }
}

export { id, build, handle, interactionPolicy };
