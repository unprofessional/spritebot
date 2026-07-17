// src/components/calculate_character_stats_button.ts

import {
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonInteraction,
} from 'discord.js';

import { getCharacterWithStats } from '../services/character.service';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import { formatCharacterStatValue } from '../utils/character_stat_display';
import { isActiveCharacter } from '../utils/is_active_character';

const id = 'calculateCharacterStats';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

type CharacterWithStats = {
  id: string;
  stats?: StatField[];
};

interface StatField {
  label: string;
  field_type: string;
  value?: string | number;
  template_id: string;
  meta?: {
    current?: number;
    max?: number;
  };
}

/**
 * Builds the "🧮 Calc Stats" button.
 */
function build(characterId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${id}:${characterId}`)
    .setLabel('🧮 Calc Stats')
    .setStyle(ButtonStyle.Secondary);
}

/**
 * Handles the button interaction to adjust numeric character stats.
 */
async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [, characterId] = interaction.customId.split(':');

  const characterRaw = await getCharacterWithStats(characterId);
  if (!characterRaw || typeof characterRaw !== 'object' || !('id' in characterRaw)) {
    await responder.respond({
      content: '⚠️ Character not found.',
      embeds: [],
      components: [],
    });
    return;
  }

  const character = characterRaw as CharacterWithStats;

  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const isSelf = await isActiveCharacter(userId, guildId, character.id);

  const { build: buildCharacterCard } = require('./view_character_card');
  const base = buildCharacterCard(character, isSelf);

  const adjustableStats = (character.stats || []).filter(
    (s: StatField) => s.field_type === 'count' || s.field_type === 'number',
  );

  if (!adjustableStats.length) {
    await responder.respond(base);
    return;
  }

  const options = adjustableStats.map((stat: StatField) => {
    const label = stat.label || 'Unnamed';
    const value = `adjust:${stat.template_id}`;
    const displayValue = formatCharacterStatValue(stat);
    const desc = displayValue ? `Current: ${displayValue}` : 'No value set';

    return new StringSelectMenuOptionBuilder().setLabel(label).setValue(value).setDescription(desc);
  });

  const dropdown = new StringSelectMenuBuilder()
    .setCustomId(`adjustStatSelect:${characterId}`)
    .setPlaceholder('🧮 Do quick math on numeric stats (+, -, ×, ÷)')
    .addOptions(options);

  const dropdownRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dropdown);

  const cancelButton = new ButtonBuilder()
    .setCustomId(`goBackToCharacter:${characterId}`)
    .setLabel('↩️ Cancel / Go Back')
    .setStyle(ButtonStyle.Secondary);

  const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(cancelButton);

  await responder.respond({
    ...base,
    content: '🧮 *Perform quick math on numeric stats using +, -, ×, or ÷.*',
    components: [dropdownRow, cancelRow],
  });
}

export { id, build, handle, interactionPolicy };
