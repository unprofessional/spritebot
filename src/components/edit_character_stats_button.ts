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
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import type { CharacterStatWithLabel } from '../types/character';
import { formatCharacterStatValue } from '../utils/character_stat_display';
import { isActiveCharacter } from '../utils/is_active_character';
import { build as buildCharacterCard } from './view_character_card';

const id = 'editCharacterStat';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

type EditableStat = CharacterStatWithLabel & { name?: string };

function build(characterId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${id}:${characterId}`)
    .setLabel('✏️ Update Stats')
    .setStyle(ButtonStyle.Primary);
}

async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [, characterId] = interaction.customId.split(':');
  const character = await getCharacterWithStats(characterId);

  if (!character) {
    await responder.respond({
      content: '⚠️ Character not found.',
      embeds: [],
      components: [],
    });
    return;
  }

  const truncate = (str: string, max = 100) =>
    str?.length > max ? str.slice(0, max - 1) + '…' : str;

  const coreFields = [
    { value: 'core:name', label: 'Name', type: 'short', current: character.name },
    { value: 'core:avatar_url', label: 'Avatar URL', type: 'short', current: character.avatar_url },
    {
      value: 'core:rp_display_name',
      label: 'RP Display Name',
      type: 'short',
      current: character.rp_display_name,
    },
    {
      value: 'core:rp_display_avatar_url',
      label: 'RP Display Avatar URL',
      type: 'short',
      current: character.rp_display_avatar_url,
    },
    { value: 'core:bio', label: 'Bio', type: 'paragraph', current: character.bio },
    { value: 'core:visibility', label: 'Visibility', type: 'short', current: character.visibility },
  ];

  const editableStats = (character.stats || []).filter((stat: EditableStat) => {
    const name = (stat.name || '').toLowerCase();
    return !['name', 'avatar_url', 'bio', 'visibility'].includes(name);
  });

  const statOptions = editableStats
    .filter(
      (stat: EditableStat) =>
        (typeof stat.template_id === 'string' && stat.template_id.trim()) ||
        (typeof stat.name === 'string' && stat.name.trim()),
    )
    .map((stat: EditableStat) => {
      const identifier = stat.template_id || stat.name;
      const currentValue = formatCharacterStatValue(stat);
      return {
        label: String(stat.label || identifier || 'Unnamed'),
        value: String(identifier),
        description: currentValue ? truncate(`Current: ${currentValue}`) : 'No value set',
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
    await responder.respond({
      content: '⚠️ No editable fields found.',
      ...base,
    });
    return;
  }

  const dropdown = new StringSelectMenuBuilder()
    .setCustomId(`editCharacterStatDropdown:${characterId}`)
    .setPlaceholder('🛠️ Manually update a stat or core field')
    .addOptions(
      options.map((option) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(option.label)
          .setValue(option.value)
          .setDescription(option.description),
      ),
    );

  const cancelButton = new ButtonBuilder()
    .setCustomId(`goBackToCharacter:${characterId}`)
    .setLabel('↩️ Cancel / Go Back')
    .setStyle(ButtonStyle.Secondary);

  const dropdownRow = new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>().addComponents(
    dropdown,
  );
  const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(cancelButton);

  await responder.respond({
    ...base,
    content: '🛠️ *Manually update a stat or core field by selecting it below.*',
    components: [dropdownRow, cancelRow],
  });
}

export { id, build, handle, interactionPolicy };
