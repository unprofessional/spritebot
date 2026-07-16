// src/components/character_page_buttons.ts

import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';
import { getCharactersByGame } from '../services/character.service';
import { getCurrentGame } from '../services/player.service';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import { rebuildListCharactersResponse } from './rebuild_list_characters_response';

const id = 'charPage';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

/**
 * Builds pagination buttons for character list.
 */
function build(page: number, hasPrev: boolean, hasNext: boolean): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

  if (hasPrev) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${id}:prev:${page}`)
        .setLabel('⬅️ Previous')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  if (hasNext) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${id}:next:${page}`)
        .setLabel('➡️ Next')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  return row;
}

/**
 * Handles button press for next/prev page in public character list.
 */
async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  try {
    const [prefix, direction, rawPage] = interaction.customId.split(':');
    if (prefix !== id) return;

    const userId = interaction.user.id;
    const guildId = interaction.guildId ?? '';
    const gameId = await getCurrentGame(userId, guildId);

    if (!gameId) {
      await responder.respond({
        content: '❌ You are not in an active game.',
        ephemeral: true,
      });
      return;
    }

    const characters = await getCharactersByGame(gameId);
    const publicChars = characters
      .filter((c) => c.visibility === 'public')
      .map((c) => ({
        id: c.id,
        name: c.name,
        created_at: c.created_at ?? '',
        visibility: c.visibility ?? 'public',
      }));

    const currentPage = parseInt(rawPage, 10) || 0;
    const nextPage = direction === 'next' ? currentPage + 1 : Math.max(0, currentPage - 1);

    const { content, components } = await rebuildListCharactersResponse(
      publicChars,
      nextPage,
      userId,
      guildId,
    );

    await responder.respond({ content, components });
  } catch (err) {
    console.error('[BUTTON ERROR] character_page_buttons:', err);
    await responder.respond({
      content: '❌ Failed to change page.',
      ephemeral: true,
    });
  }
}

export { build, handle, id, interactionPolicy };
