// src/components/toggle_character_visibility_button.ts

import { ButtonBuilder, ButtonStyle, ButtonInteraction } from 'discord.js';

import { getCharacterWithStats, updateCharacterMeta } from '../services/character.service';
import { getCurrentCharacter } from '../services/player.service';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import { build as buildCharacterCard } from './view_character_card';

const id = 'handleToggleCharacterVisibilityButton';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

function build(characterId: string, currentVisibility = 'private'): ButtonBuilder {
  const isPublic = (currentVisibility || '').toLowerCase() === 'public';

  return new ButtonBuilder()
    .setCustomId(`${id}:${characterId}`)
    .setLabel(isPublic ? '🔒 Unpublish Character' : '🌐 Publish Character')
    .setStyle(ButtonStyle.Secondary);
}

async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [, characterId] = interaction.customId.split(':');

  try {
    const character = await getCharacterWithStats(characterId);

    if (!character) {
      await responder.respond({
        content: '⚠️ Character not found.',
        ephemeral: true,
      });
      return;
    }

    const current = (character.visibility || 'private').toLowerCase();
    const newVisibility = current === 'private' ? 'public' : 'private';

    await updateCharacterMeta(characterId, { visibility: newVisibility });

    const updated = await getCharacterWithStats(characterId);
    if (!updated) {
      await responder.respond({
        content: '⚠️ Character not found after updating visibility.',
        ephemeral: true,
      });
      return;
    }

    const userId = interaction.user.id;
    const guildId = interaction.guildId!;
    const isSelf = (await getCurrentCharacter(userId, guildId)) === characterId;
    const updatedCard = buildCharacterCard(updated, isSelf);

    await responder.respond({
      ...updatedCard,
      content: `✅ Visibility set to **${newVisibility.charAt(0).toUpperCase() + newVisibility.slice(1)}**.`,
    });
  } catch (err) {
    console.error('[TOGGLE VISIBILITY ERROR]', err);
    await responder.respond({
      content: '❌ Failed to toggle visibility.',
      ephemeral: true,
    });
  }
}

export { id, build, handle, interactionPolicy };
