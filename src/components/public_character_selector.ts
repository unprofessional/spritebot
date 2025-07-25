// src/components/public_character_selector.ts

import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';

import { getCharacterWithStats } from '../services/character.service';
import { isActiveCharacter } from '../utils/is_active_character';
import { build as buildCharacterCard } from './view_character_card';

const id = 'selectPublicCharacter';

interface PublicCharacterOption {
  id: string;
  label: string;
  description: string;
}

/**
 * Builds the character select dropdown for public characters.
 */
function build(
  page: number,
  characters: PublicCharacterOption[],
): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = characters.map((char) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(char.label)
      .setDescription(char.description)
      .setValue(char.id),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${id}:${page}`)
    .setPlaceholder('Select a character to view...')
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

/**
 * Handles selection of a public character from the dropdown.
 */
async function handle(interaction: StringSelectMenuInteraction): Promise<void> {
  try {
    const [customId] = interaction.customId.split(':');
    if (customId !== id) return;

    const characterId = interaction.values?.[0];
    if (!characterId) {
      await interaction.reply({
        content: '⚠️ No character selected.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const character = await getCharacterWithStats(characterId);
    if (!character) {
      await interaction.editReply({
        content: '❌ That character no longer exists.',
      });
      return;
    }

    const isSelf = await isActiveCharacter(
      interaction.user.id,
      interaction.guildId!,
      character.id as string,
    );
    const view = buildCharacterCard(character, isSelf);

    await interaction.editReply(view);
  } catch (err) {
    console.error('[SELECT MENU ERROR] public_character_selector:', err);
    if (!interaction.replied) {
      await interaction.reply({
        content: '❌ Failed to display character details.',
        ephemeral: true,
      });
    }
  }
}

export { id, build, handle };
