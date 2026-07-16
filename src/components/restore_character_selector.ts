// src/components/restore_character_selector.ts

import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { getRestorableCharacters, restoreCharacterForUser } from '../services/character.service';
import { formatTimeAgo } from '../utils/time_ago';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';

export const id = 'restoreCharacterDropdown';
export const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

export async function build(
  userId: string,
  guildId: string,
): Promise<
  | { content: string; ephemeral: true }
  | { content: string; components: ActionRowBuilder<StringSelectMenuBuilder>[]; ephemeral: true }
> {
  const characters = await getRestorableCharacters(userId, guildId);

  if (!characters.length) {
    return {
      content:
        '📭 No restorable characters found in your current game. Characters can be restored for 30 days after deletion.',
      ephemeral: true,
    };
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder('Choose a character to restore')
    .addOptions(
      characters.slice(0, 25).map((character) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(character.name.slice(0, 100))
          .setDescription(
            `Deleted ${formatTimeAgo(character.deleted_at ?? new Date().toISOString())}`.slice(
              0,
              100,
            ),
          )
          .setValue(character.id),
      ),
    );

  return {
    content: '♻️ Choose a character to restore. Restored characters return as private.',
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    ephemeral: true,
  };
}

export async function handle(
  interaction: StringSelectMenuInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const selected = interaction.values[0];
  const { guildId, user } = interaction;

  if (!guildId) {
    await responder.respond({
      content: '⚠️ This action must be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (!selected) {
    await responder.respond({
      content: '⚠️ No character selected.',
      ephemeral: true,
    });
    return;
  }

  const result = await restoreCharacterForUser({
    characterId: selected,
    userId: user.id,
    guildId,
  });

  if (!result.ok) {
    const message =
      result.reason === 'expired'
        ? '⚠️ That character is outside the 30-day restore window.'
        : '⚠️ That character can no longer be restored from this menu.';

    await responder.respond({
      content: message,
      components: [],
    });
    return;
  }

  await responder.respond({
    content: `✅ Restored **${result.character.name}** as a private character and made them active. Use \`/view-character\` to review them.`,
    components: [],
  });
}
