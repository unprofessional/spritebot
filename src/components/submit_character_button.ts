// src/components/submit_character_button.ts

import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';

import { getCharacterWithStats } from '../services/character.service';
import {
  finalizeCharacterCreation,
  getTempCharacterData,
  isDraftComplete,
} from '../services/character_draft.service';
import { setCurrentCharacter } from '../services/player.service';
import { isActiveCharacter } from '../utils/is_active_character';
import { build as buildCharacterCard } from './view_character_card';

const id = 'submitNewCharacter';

function build(isDisabled = false): ActionRowBuilder<ButtonBuilder> {
  const button = new ButtonBuilder()
    .setCustomId(id)
    .setLabel('✅ Submit Character')
    .setStyle(ButtonStyle.Success)
    .setDisabled(isDisabled);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

async function handle(interaction: ButtonInteraction): Promise<void> {
  const { user, guildId } = interaction;
  const userId = user.id;

  try {
    const complete = await isDraftComplete(userId);
    console.log(`[submit_character_button] Draft completeness for user ${userId}: ${complete}`);

    if (!complete) {
      await interaction.reply({
        content: '⚠️ Your character is missing required fields. Please finish filling them out.',
        ephemeral: true,
      });
      return;
    }

    const draft = await getTempCharacterData(userId);
    if (!draft) {
      await interaction.reply({
        content: '❌ Draft data missing. Please restart character creation.',
        ephemeral: true,
      });
      return;
    }

    console.log(`[submit_character_button] Draft data for user ${userId}:`, draft);

    const character = await finalizeCharacterCreation(userId, draft);
    console.log(
      `[submit_character_button] Finalized character: ${character.name} (${character.id})`,
    );

    await setCurrentCharacter(userId, guildId!, character.id);
    console.log(
      `[submit_character_button] Set ${character.name} (${character.id}) as active character for ${userId} in ${guildId}`,
    );

    const fullCharacter = await getCharacterWithStats(character.id);
    if (!fullCharacter) {
      await interaction.reply({
        content: '❌ Failed to load character details after creation.',
        ephemeral: true,
      });
      return;
    }

    const isSelf = await isActiveCharacter(userId, guildId!, character.id);
    const view = buildCharacterCard(fullCharacter, isSelf);

    await interaction.update({
      content: `✅ Character **${character.name}** created successfully!`,
      embeds: view.embeds,
      components: view.components,
    });
  } catch (err) {
    console.error('[submit_character_button] Failed to submit character:', err);
    await interaction.reply({
      content: '❌ Failed to submit character. Please try again.',
      ephemeral: true,
    });
  }
}

export { build, handle, id };
