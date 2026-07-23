import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import {
  formatRollResult,
  MAX_DICE,
  MAX_SIDES,
  MIN_DICE,
  MIN_SIDES,
  parseDiceExpression,
  rollDice,
} from '../utils/dice_roller';
import { getCharacterById } from '../services/character.service';
import { getCurrentCharacter } from '../services/player.service';
import { recordD20Roll } from '../services/d20_roll.service';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicySource,
} from '../discord/interaction_dispatch';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice.')
    .addStringOption((option) =>
      option
        .setName('dice')
        .setDescription(
          `Roll expression, like 2d20 or 2D20 (${MIN_DICE}d${MIN_SIDES}-${MAX_DICE}d${MAX_SIDES}).`,
        )
        .setRequired(true),
    ),

  interactionPolicy: ((interaction: ChatInputCommandInteraction<CacheType>) => ({
    mode: {
      kind: 'reply',
      visibility: parseRollExpression(interaction.options.getString('dice', true))
        ? 'public'
        : 'ephemeral',
    },
    acknowledgement: 'auto-defer',
  })) satisfies InteractionDispatchPolicySource<ChatInputCommandInteraction<CacheType>>,

  async execute(
    interaction: ChatInputCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    const expression = interaction.options.getString('dice', true);
    const parsed = parseRollExpression(expression);
    if (!parsed) {
      return responder.respond({
        content: `⚠️ Use a roll like \`2d20\` or \`2D20\`. Supported range is \`${MIN_DICE}d${MIN_SIDES}\` through \`${MAX_DICE}d${MAX_SIDES}\`.`,
        ephemeral: true,
      });
    }

    const result = rollDice(parsed.numDice, parsed.numSides);
    try {
      await recordD20Roll({
        numDice: result.numDice,
        numSides: result.numSides,
        result: result.total,
        interactionId: interaction.id,
      });
    } catch (err) {
      console.warn('[roll] Failed to record 1d20 telemetry:', err);
    }
    const rollerName = await resolveRollerDisplayName(interaction);

    return responder.respond({
      content: formatRollResult(result, rollerName),
      allowedMentions: { parse: [] },
    });
  },
};

function parseRollExpression(expression: string): { numDice: number; numSides: number } | null {
  try {
    return parseDiceExpression(expression);
  } catch {
    return null;
  }
}

async function resolveRollerDisplayName(
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<string> {
  const characterName = await resolveActiveCharacterName(interaction);
  return characterName ?? getInteractionDisplayName(interaction);
}

async function resolveActiveCharacterName(
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<string | null> {
  if (!interaction.guildId) return null;

  try {
    const characterId = await getCurrentCharacter(interaction.user.id, interaction.guildId);
    if (!characterId) return null;

    const character = await getCharacterById(characterId);
    return cleanDisplayName(character?.name);
  } catch (err) {
    console.warn('[roll] Failed to resolve active character name:', err);
    return null;
  }
}

function getInteractionDisplayName(interaction: ChatInputCommandInteraction<CacheType>): string {
  const member = interaction.member as
    | {
        displayName?: unknown;
        nick?: unknown;
      }
    | null
    | undefined;

  return (
    cleanDisplayName(member?.displayName) ??
    cleanDisplayName(member?.nick) ??
    cleanDisplayName(interaction.user.displayName) ??
    cleanDisplayName(interaction.user.username) ??
    interaction.user.id
  );
}

function cleanDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned.length > 0 ? cleaned : null;
}
