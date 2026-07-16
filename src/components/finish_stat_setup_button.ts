// src/components/finish_stat_setup_button.ts

import {
  ButtonStyle,
  type ButtonInteraction,
  type APIButtonComponentWithCustomId,
  type ActionRowData,
  type MessageActionRowComponentData,
} from 'discord.js';

import { getGame, getStatTemplates } from '../services/game.service';
import { appendNudge, buildNudge } from '../utils/onboarding_nudge';
import { rebuildCreateGameResponse } from '../utils/rebuild_create_game_response';

import type { Game } from '../types/game';
import type { StatTemplate } from '../types/stat_template';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';

const id = 'finishStatSetup';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

function build(gameId: string): APIButtonComponentWithCustomId {
  return {
    custom_id: `${id}:${gameId}`,
    label: '↩️ Cancel / Go Back',
    style: ButtonStyle.Secondary,
    type: 2,
  };
}

async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [, gameId] = interaction.customId.split(':');

  try {
    const [game, stats] = await Promise.all([
      getGame({ id: gameId }) as Promise<Game | null>,
      getStatTemplates(gameId) as Promise<StatTemplate[]>,
    ]);

    if (!game) {
      await responder.respond({
        content: '❌ Game not found. You may need to recreate it.',
        ephemeral: true,
      });
      return;
    }

    await responder.acknowledge();

    const result = rebuildCreateGameResponse(game, stats);
    const nudge = buildNudge(
      {
        userId: interaction.user.id,
        guildId: interaction.guildId ?? '',
        gameId,
        isGM: game.created_by === interaction.user.id,
        gameIsPublished: game.is_public,
        hasStatTemplates: stats.length > 0,
      },
      'finish-stat-setup',
    );

    await responder.respond({
      content: appendNudge(result.content, nudge),
      embeds: result.embeds,
      components: result.components.map((row) =>
        row.toJSON(),
      ) as ActionRowData<MessageActionRowComponentData>[],
    });
  } catch (err) {
    console.error('Error in finishStatSetup:', err);
    await responder.respond({
      content: '❌ Something went wrong while finalizing your game setup.',
      ephemeral: true,
    });
  }
}

export { id, build, handle, interactionPolicy };
