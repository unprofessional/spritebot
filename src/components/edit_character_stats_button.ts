// src/components/edit_character_stats_button.ts

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ButtonInteraction,
  StringSelectMenuOptionBuilder,
} from 'discord.js';

import { getCharacterWithStats } from '../services/character.service';
import { isActiveCharacter } from '../utils/is_active_character';

const id = 'editCharacterStat';

function build(characterId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${id}:${characterId}`)
    .setLabel('✏️ Update Stats')
    .setStyle(ButtonStyle.Primary);
}

async function handle(interaction: ButtonInteraction): Promise<void> {
  const [, characterId] = interaction.customId.split(':');
  const character = (await getCharacterWithStats(characterId as string)) as any;

  if (!character) {
    await interaction.update({
      content: '⚠️ Character not found.',
      embeds: [],
      components: [],
    });
    return;
  }

  const { build: buildCharacterCard } = require('./view_character_card');

  const truncate = (str: string, max = 100) =>
    str?.length > max ? str.slice(0, max - 1) + '…' : str;

  const coreFields = [
    { value: 'core:name', label: 'Name', type: 'short', current: character.name },
    { value: 'core:avatar_url', label: 'Avatar URL', type: 'short', current: character.avatar_url },
    { value: 'core:bio', label: 'Bio', type: 'paragraph', current: character.bio },
    { value: 'core:visibility', label: 'Visibility', type: 'short', current: character.visibility },
  ];

  const editableStats = (character.stats || []).filter((stat: any) => {
    const name = (stat.name || '').toLowerCase();
    return !['name', 'avatar_url', 'bio', 'visibility'].includes(name);
  });

  const statOptions = editableStats
    .filter(
      (stat: any) =>
        (typeof stat.template_id === 'string' && stat.template_id.trim()) ||
        (typeof stat.name === 'string' && stat.name.trim()),
    )
    .map((stat: any) => {
      const identifier = stat.template_id || stat.name;
      return {
        label: String(stat.label || identifier || 'Unnamed'),
        value: String(identifier),
        description: stat.value != null ? truncate(`Current: ${stat.value}`) : 'No value set',
      };
    });

  const coreOptions = coreFields.map((field) => ({
    label: `[CORE] ${field.label}`,
    value: field.value,
    description: field.current ? truncate(`Current: ${field.current}`) : 'No value set',
  }));

  const options = [...coreOptions, ...statOptions].slice(0, 25);

  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const isSelf = await isActiveCharacter(userId, guildId, character.id);
  const base = buildCharacterCard(character, isSelf);

  if (options.length === 0) {
    await interaction.update({
      content: '⚠️ No editable fields found.',
      ...base,
    });
    return;
  }

  const dropdown = new StringSelectMenuBuilder()
    .setCustomId(`editCharacterStatDropdown:${characterId}`)
    .setPlaceholder('🛠️ Manually update a stat or core field')
    .addOptions(options as StringSelectMenuOptionBuilder[]);

  const cancelButton = new ButtonBuilder()
    .setCustomId(`goBackToCharacter:${characterId}`)
    .setLabel('↩️ Cancel / Go Back')
    .setStyle(ButtonStyle.Secondary);

  const dropdownRow = new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>().addComponents(
    dropdown,
  );
  const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(cancelButton);

  await interaction.update({
    ...base,
    content: '🛠️ *Manually update a stat or core field by selecting it below.*',
    components: [dropdownRow, cancelRow],
  });
}

export { id, build, handle };
