import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
} from 'discord.js';

import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import { getRestorableGames, restoreGame } from '../services/game.service';
import { formatTimeAgo } from '../utils/time_ago';

export const id = 'restoreGameDropdown';
export const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

export async function build(
  userId: string,
  guildId: string,
): Promise<
  | { content: string; ephemeral: true }
  | { content: string; components: ActionRowBuilder<StringSelectMenuBuilder>[]; ephemeral: true }
> {
  const games = await getRestorableGames(userId, guildId);

  if (!games.length) {
    return {
      content:
        '📭 You have no restorable games in this server. Games can be restored for 30 days after deletion.',
      ephemeral: true,
    };
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder('Choose a game to restore')
    .addOptions(
      games.slice(0, 25).map((game) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(game.name.slice(0, 100))
          .setDescription(
            `Deleted ${formatTimeAgo(game.deleted_at ?? new Date().toISOString())}`.slice(0, 100),
          )
          .setValue(game.id),
      ),
    );

  return {
    content:
      '♻️ Choose a game to restore. Its game-deleted characters will return as private characters.',
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    ephemeral: true,
  };
}

export async function handle(
  interaction: StringSelectMenuInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const gameId = interaction.values[0];
  if (!gameId) {
    await responder.respond({ content: '⚠️ No game selected.', ephemeral: true });
    return;
  }

  const result = await restoreGame(gameId, interaction.user.id);
  if (!result.ok) {
    const content =
      result.reason === 'expired'
        ? '⚠️ That game is outside the 30-day restore window.'
        : '⚠️ That game can no longer be restored from this menu.';
    await responder.respond({ content, components: [] });
    return;
  }

  await responder.respond({
    content: `✅ Restored **${result.game.name}** and **${result.characterCount}** game-deleted character(s). Restored characters are private. Players can rejoin or switch back to the game.`,
    components: [],
  });
}
