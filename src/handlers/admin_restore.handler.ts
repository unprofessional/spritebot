// src/handlers/admin_restore.handler.ts

import { ChatInputCommandInteraction } from 'discord.js';
import { restoreCharacterAsAdmin } from '../services/character.service';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';

function restoreFailureMessage(reason: string): string {
  if (reason === 'not_deleted') return '⚠️ That character is not currently deleted.';
  return '⚠️ Could not find a deleted character with that id.';
}

export async function handleAdminRestoreCharacter(
  interaction: ChatInputCommandInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const characterId = interaction.options.getString('character_id', true).trim();
  const result = await restoreCharacterAsAdmin(characterId);

  if (!result.ok) {
    await responder.respond({
      content: restoreFailureMessage(result.reason),
      ephemeral: true,
    });
    return;
  }

  await responder.respond({
    content: `✅ Restored **${result.character.name}** as a private character.`,
    ephemeral: true,
  });
}
