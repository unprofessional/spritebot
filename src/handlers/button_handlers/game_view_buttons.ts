import type { ButtonInteraction } from 'discord.js';

import { build as buildViewGameCard } from '../../components/view_game_card';
import type { InteractionDispatchPolicy } from '../../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';
import { getGameById, getStatTemplates } from '../../services/game.service';
import type { StatTemplate } from '../../types/stat_template';

const id = 'goBackToGame';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  if (!interaction.customId.startsWith(`${id}:`)) return;

  const [, gameId] = interaction.customId.split(':');
  const game = await getGameById(gameId);
  if (!game) {
    await responder.respond({
      content: '❌ Game not found.',
      embeds: [],
      components: [],
    });
    return;
  }

  const templates = (await getStatTemplates(gameId)) as StatTemplate[];
  await responder.respond({ ...buildViewGameCard(game, templates, interaction.user.id) });
}

export { id, interactionPolicy, handle };
