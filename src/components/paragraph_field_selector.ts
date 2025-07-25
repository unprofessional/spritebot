// src/components/paragraph_field_selector.ts

import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { getCharacterWithStats } from '../services/character.service';
import { CharacterWithStats, CharacterStatWithLabel } from '../types/character';

const id = 'paragraphFieldSelect';

function truncateForDescription(text: string): string {
  if (!text) return '';
  const clean = text.trim();
  return clean.length > 100 ? clean.slice(0, 97) + '...' : clean;
}

/**
 * Builds the paragraph field select menu.
 */
function build(character: CharacterWithStats): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const options: StringSelectMenuOptionBuilder[] = [];

  if (character.bio?.trim()) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel('Bio')
        .setValue('core:bio')
        .setDescription(truncateForDescription(character.bio)),
    );
  }

  for (const stat of character.stats || []) {
    if (stat.field_type === 'paragraph' && stat.value?.trim()) {
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(stat.label)
          .setValue(`game:${stat.template_id}`)
          .setDescription(truncateForDescription(stat.value)),
      );
    }
  }

  if (!options.length) return null;

  const dropdown = new StringSelectMenuBuilder()
    .setCustomId(`${id}:${character.id}`)
    .setPlaceholder('📜 Select a paragraph field to view')
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dropdown);
}

/**
 * Handles dropdown selection of paragraph fields.
 */
async function handle(interaction: StringSelectMenuInteraction): Promise<void> {
  const [, characterId] = interaction.customId.split(':');
  const selected = interaction.values?.[0];

  const character: CharacterWithStats | null = await getCharacterWithStats(characterId);
  if (!character || !selected) {
    await interaction.reply({
      content: '❌ Unable to load character or field.',
      ephemeral: true,
    });
    return;
  }

  let label = '(unknown)';
  let fullText = '';

  if (selected === 'core:bio') {
    label = 'Bio';
    fullText = character.bio ?? '';
  } else if (selected.startsWith('game:')) {
    const templateId = selected.split(':')[1];
    const stat = character.stats?.find((s: CharacterStatWithLabel) => s.template_id === templateId);
    if (stat) {
      label = stat.label ?? stat.template_id;
      fullText = stat.value ?? '';
    }
  }

  if (!fullText.trim()) {
    await interaction.reply({
      content: `ℹ️ No content available for **${label}**.`,
      ephemeral: true,
    });
    return;
  }

  const paragraphs = fullText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).length > 1900) {
      if (current) chunks.push(current);
      current = paragraph;
    } else {
      current += (current ? '\n\n' : '') + paragraph;
    }
  }
  if (current) chunks.push(current);

  if (chunks.length === 0) {
    await interaction.reply({
      content: `ℹ️ No usable content found for **${label}**.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `**${label}**\n\n${chunks[0]}`,
    ephemeral: true,
  });

  for (let i = 1; i < chunks.length; i++) {
    await interaction.followUp({
      content: chunks[i],
      ephemeral: true,
    });
  }
}

export { build, handle, id };
