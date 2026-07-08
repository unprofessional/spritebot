import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import {
  formatRollResult,
  MAX_DICE,
  MAX_SIDES,
  MIN_DICE,
  MIN_SIDES,
  rollDice,
} from '../utils/dice_roller';
import { getCharacterById } from '../services/character.service';
import { getCurrentCharacter } from '../services/player.service';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice.')
    .addIntegerOption((option) =>
      option
        .setName('num-dice')
        .setDescription(`Number of dice to roll (${MIN_DICE}-${MAX_DICE}).`)
        .setMinValue(MIN_DICE)
        .setMaxValue(MAX_DICE)
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('num-sides')
        .setDescription(`Number of sides on each die (${MIN_SIDES}-${MAX_SIDES}).`)
        .setMinValue(MIN_SIDES)
        .setMaxValue(MAX_SIDES)
        .setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    const numDice = interaction.options.getInteger('num-dice', true);
    const numSides = interaction.options.getInteger('num-sides', true);
    const result = rollDice(numDice, numSides);
    const rollerName = await resolveRollerDisplayName(interaction);

    return interaction.reply({
      content: formatRollResult(result, rollerName),
      allowedMentions: { parse: [] },
    });
  },
};

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
