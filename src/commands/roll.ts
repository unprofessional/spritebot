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

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    const expression = interaction.options.getString('dice', true);
    const parsed = parseRollExpression(expression);
    if (!parsed) {
      return interaction.reply({
        content: `⚠️ Use a roll like \`2d20\` or \`2D20\`. Supported range is \`${MIN_DICE}d${MIN_SIDES}\` through \`${MAX_DICE}d${MAX_SIDES}\`.`,
        ephemeral: true,
      });
    }

    const result = rollDice(parsed.numDice, parsed.numSides);
    const rollerName = await resolveRollerDisplayName(interaction);

    return interaction.reply({
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
