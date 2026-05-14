import type { ModalSubmitInteraction } from 'discord.js';
import {
  getCharacterWithStats,
  updateStat,
  updateStatMetaField,
} from '../../services/character.service';

import { isActiveCharacter } from '../../utils/is_active_character';
import { build as buildCharacterCard } from '../../components/view_character_card';

/**
 * Handles modal for adjusting stats (add/subtract/multiply/divide flow).
 */
export async function handle(interaction: ModalSubmitInteraction): Promise<void> {
  const { customId } = interaction;
  if (!customId.startsWith('adjustStatModal:')) return;

  const [, characterId, statId] = customId.split(':');
  const operator = interaction.fields.getTextInputValue('deltaOperator')?.trim();
  const valueRaw = interaction.fields.getTextInputValue('deltaValue')?.trim();
  const value = parseInt(valueRaw ?? '', 10);

  if (!['+', '-', '*', '/'].includes(operator)) {
    await interaction.reply({
      content: '⚠️ Invalid operator. Use one of: +, -, *, /',
      ephemeral: true,
    });
    return;
  }

  if (isNaN(value)) {
    await interaction.reply({
      content: '⚠️ Invalid number entered.',
      ephemeral: true,
    });
    return;
  }

  const character = await getCharacterWithStats(characterId);
  if (!character) {
    await interaction.reply({
      content: '⚠️ Character not found.',
      ephemeral: true,
    });
    return;
  }

  const stat = character.stats.find((s) => s.template_id === statId);
  if (!stat) {
    await interaction.reply({
      content: '⚠️ Stat not found.',
      ephemeral: true,
    });
    return;
  }

  let current: number;
  if (stat.field_type === 'count') {
    current = parseInt(stat.meta?.current ?? stat.meta?.max ?? '0', 10);
  } else if (stat.field_type === 'number') {
    current = parseInt(stat.value ?? '0', 10);
  } else {
    await interaction.reply({
      content: `⚠️ Cannot adjust stat of type: ${stat.field_type}`,
      ephemeral: true,
    });
    return;
  }

  let next: number;
  switch (operator) {
    case '+':
      next = current + value;
      break;
    case '-':
      next = current - value;
      break;
    case '*':
      next = current * value;
      break;
    case '/':
      next = value === 0 ? current : Math.floor(current / value);
      break;
    default:
      next = current;
  }

  if (stat.field_type === 'count') {
    await updateStatMetaField(characterId, statId, 'current', next);
  } else {
    await updateStat(characterId, statId, String(next));
  }

  const updated = await getCharacterWithStats(characterId);
  if (!updated) {
    await interaction.reply({
      content: '⚠️ Could not refresh character data.',
      ephemeral: true,
    });
    return;
  }

  const isSelf = await isActiveCharacter(
    interaction.user.id,
    interaction.guildId ?? '',
    characterId,
  );
  const view = buildCharacterCard(updated, isSelf);

  await interaction.deferUpdate();
  await interaction.editReply({
    ...view,
    content: `✅ Updated **${stat.label}**: ${current} ${operator} ${value} → ${next}`,
  });
}
