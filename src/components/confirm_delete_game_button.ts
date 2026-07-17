import { ButtonBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';

import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import { deleteGame, getGameById, getStatTemplates } from '../services/game.service';
import type { StatTemplate } from '../types/stat_template';
import { build as buildViewGameCard } from './view_game_card';

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

  if (interaction.customId.startsWith('cancelDeleteGame:')) {
    const game = await getGameById(gameId);
    if (!game || game.created_by !== interaction.user.id) {
      await responder.respond({
        content: '❌ This game is no longer available.',
        embeds: [],
        components: [],
      });
      return;
    }
    const templates = (await getStatTemplates(gameId)) as StatTemplate[];
    await responder.respond({ ...buildViewGameCard(game, templates, interaction.user.id) });
    return;
  }

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
