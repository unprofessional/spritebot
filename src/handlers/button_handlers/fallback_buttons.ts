// src/handlers/button_handlers/fallback_buttons.ts

import { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';

import { getCharactersByUser, getCharacterWithStats } from '../../services/character.service';
import { isActiveCharacter } from '../../utils/is_active_character';
import { build as buildCharacterCard } from '../../components/view_character_card';
import type { InteractionDispatchPolicy } from '../../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';

export const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

export async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  await responder.respond({
    content: '❌ Unrecognized button interaction.',
    ephemeral: true,
  });
}

export async function execute(
  interaction: ChatInputCommandInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guild?.id;

  if (!guildId) {
    await responder.respond({
      content: '⚠️ This command must be used in a server.',
      ephemeral: true,
    });
    return;
  }

  try {
    const allCharacters = await getCharactersByUser(userId, guildId);
    const character = allCharacters[0];

    if (!character) {
      await responder.respond({
        content: '⚠️ No character found. Use `/create-character` to start one.',
        ephemeral: true,
      });
      return;
    }

    const full = await getCharacterWithStats(character.id);
    if (!full) {
      await responder.respond({
        content: '❌ Failed to load character details.',
        ephemeral: true,
      });
      return;
    }

    const isSelf = await isActiveCharacter(userId, guildId, character.id);
    const view = buildCharacterCard(full, isSelf);

    await responder.respond({
      ...view,
      ephemeral: true,
    });
  } catch (err) {
    console.error('[SLASH COMMAND FALLBACK ERROR]:', err);
    await responder.respond({
      content: '❌ Failed to load character view.',
      ephemeral: true,
    });
  }
}
