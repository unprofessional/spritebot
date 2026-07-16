// src/components/delete_character_button.ts

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction } from 'discord.js';

import { getCharacterWithStats } from '../services/character.service';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import { build as buildConfirmDeleteButton } from './confirm_delete_character_button';

const id = 'deleteCharacter';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

function build(characterId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${id}:${characterId}`)
    .setLabel('🗑️ Delete Character')
    .setStyle(ButtonStyle.Danger);
}

async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const { customId, user } = interaction;
  const [, characterId] = customId.split(':');

  try {
    const character = await getCharacterWithStats(characterId);

    if (!character || character.user_id !== user.id) {
      await responder.respond({
        content: '❌ You do not have permission to delete this character.',
        ephemeral: true,
      });
      return;
    }

    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      buildConfirmDeleteButton(characterId),
      new ButtonBuilder()
        .setCustomId(`goBackToCharacter:${characterId}`)
        .setLabel('↩️ Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await responder.respond({
      content: [
        `🗑️ Are you sure you want to delete **${character.name}**?`,
        '⚠️ You will have **30 days** to restore this character before it is permanently removed. Use `/restore-character` to recover it.',
      ].join('\n'),
      embeds: [],
      components: [confirmRow],
    });
  } catch (err) {
    console.error('Error preparing delete character confirmation:', err);
    await responder.respond({
      content: '❌ Something went wrong while preparing to delete this character.',
      ephemeral: true,
    });
  }
}

export { id, build, handle, interactionPolicy };
