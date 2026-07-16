// src/handlers/button_handlers/character_view_buttons.ts

import { ButtonInteraction } from 'discord.js';
import { getCharacterWithStats } from '../../services/character.service';
import { isActiveCharacter } from '../../utils/is_active_character';
import { build as buildCharacterCard } from '../../components/view_character_card';
import type { CharacterWithStats } from '../../types/character'; // Adjust once the correct type is finalized
import type { InteractionDispatchPolicy } from '../../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';

const id = 'goBackToCharacter';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

/**
 * Handles "Go Back to Character" button.
 */
async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const { customId } = interaction;

  if (!customId.startsWith(`${id}:`)) return;

  const [, characterId] = customId.split(':');

  const character = (await getCharacterWithStats(characterId)) as CharacterWithStats | null;
  if (!character) {
    await responder.respond({
      content: '❌ Character not found.',
      embeds: [],
      components: [],
    });
    return;
  }

  const userId = interaction.user.id;
  const guildId = interaction.guildId ?? ''; // ✅ fix: ensure it's a string
  const isSelf = await isActiveCharacter(userId, guildId, character.id);
  const view = buildCharacterCard(character, isSelf);

  await responder.respond(view);
}

export { id, interactionPolicy, handle };
