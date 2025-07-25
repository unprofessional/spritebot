// src/components/view_paragraph_fields_button.ts

import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';

import { getCharacterWithStats } from '../services/character.service';
import { CharacterWithStats } from '../types/character';
import { build as buildParagraphFieldDropdown } from './paragraph_field_selector';

const id = 'viewParagraphFields';

/**
 * Builds the "📜 View Full Descriptions" button.
 */
function build(characterId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${id}:${characterId}`)
    .setLabel('📜 View Full Descriptions')
    .setStyle(ButtonStyle.Secondary);
}

/**
 * Handles the button interaction and presents a dropdown of long-form fields.
 */
async function handle(interaction: ButtonInteraction): Promise<void> {
  const [, characterId] = interaction.customId.split(':');

  const character: CharacterWithStats | null = await getCharacterWithStats(characterId);
  if (!character) {
    await interaction.reply({
      content: '❌ Character not found.',
      ephemeral: true,
    });
    return;
  }

  const dropdownRow: ActionRowBuilder | null = buildParagraphFieldDropdown(character);
  if (!dropdownRow) {
    await interaction.reply({
      content: 'ℹ️ No long-form descriptions available.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: '📜 *Select a long-form field below to view its full content.*',
    components: [dropdownRow.toJSON()],
    ephemeral: true,
  });
}

export { build, handle, id };
