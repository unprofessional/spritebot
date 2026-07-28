import {
  ActionRowData,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  MessageActionRowComponentData,
} from 'discord.js';
import { discordCustomId } from '../utils/discord_custom_id';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import {
  applyCustomStatPreset,
  CustomStatPresetConflictError,
} from '../services/custom_stat_definition.service';
import { getGame, getStatTemplates } from '../services/game.service';
import type { Game } from '../types/game';
import type { StatTemplate } from '../types/stat_template';
import { rebuildCreateGameResponse } from '../utils/rebuild_create_game_response';

const id = 'applyStatPreset';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

function build(gameId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(discordCustomId(`${id}:${gameId}:ffrp`))
    .setLabel('✨ Apply FFRP Preset')
    .setStyle(ButtonStyle.Secondary);
}

async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [, gameId, presetKey] = interaction.customId.split(':');
  const game = (await getGame({ id: gameId })) as Game | null;
  if (!game || game.created_by !== interaction.user.id) {
    await responder.respond({
      content: '⚠️ Only the GM can apply a custom-stat preset.',
      ephemeral: true,
    });
    return;
  }

  let result: Awaited<ReturnType<typeof applyCustomStatPreset>>;
  try {
    result = await applyCustomStatPreset(gameId, presetKey);
  } catch (error) {
    if (error instanceof CustomStatPresetConflictError) {
      await responder.respond({ content: `⚠️ ${error.message}`, ephemeral: true });
      return;
    }
    throw error;
  }
  const [updatedGame, stats] = await Promise.all([
    getGame({ id: gameId }) as Promise<Game>,
    getStatTemplates(gameId) as Promise<StatTemplate[]>,
  ]);
  const response = rebuildCreateGameResponse(updatedGame, stats);
  const summary = result.created.length
    ? `✅ Applied **${result.preset.label} v${result.preset.version}** and added ${result.created.map((stat) => `\`${stat.stat_key}\``).join(', ')}.`
    : `✅ **${result.preset.label} v${result.preset.version}** was already fully applied; no custom stats were changed.`;

  await responder.respond({
    ...response,
    content: `${summary}\n\n${response.content}`,
    components: response.components.map((row) =>
      row.toJSON(),
    ) as ActionRowData<MessageActionRowComponentData>[],
  });
}

export { build, handle, id, interactionPolicy };
