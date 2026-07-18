import { ButtonBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';

import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import { deleteGame } from '../services/game.service';

const id = 'confirmDeleteGame';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

function build(gameId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${id}:${gameId}`)
    .setLabel('✅ Confirm Delete')
    .setStyle(ButtonStyle.Danger);
}

async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [, gameId] = interaction.customId.split(':');

  try {
    const result = await deleteGame(gameId, interaction.user.id);
    if (!result.ok) {
      const content =
        result.reason === 'not_owner'
          ? '❌ You do not have permission to delete this game.'
          : '⚠️ This game is no longer available to delete.';
      await responder.respond({ content, embeds: [], components: [] });
      return;
    }

    await responder.respond({
      content: [
        `🗑️ Deleted **${result.game.name}**.`,
        `Characters affected: **${result.characterCount}**`,
        `Players removed from the game: **${result.playerCount}**`,
        `In-character channel modes cleared: **${result.rpModeCount}**`,
        '⚠️ You have **30 days** to restore it before it is permanently removed. Use `/restore-game` to recover it.',
      ].join('\n'),
      embeds: [],
      components: [],
    });
  } catch (error) {
    console.error('Failed to delete game:', error);
    await responder.respond({
      content: '❌ Something went wrong while deleting the game.',
      ephemeral: true,
    });
  }
}

export { id, build, handle, interactionPolicy };
