// src/components/restore_character_selector.ts

import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { getRestorableCharacters, restoreCharacterForUser } from '../services/character.service';
import { formatTimeAgo } from '../utils/time_ago';

export const id = 'restoreCharacterDropdown';

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

export async function handle(interaction: StringSelectMenuInteraction): Promise<void> {
  const selected = interaction.values[0];
  const { guildId, user } = interaction;

  if (!guildId) {
    await interaction.reply({
      content: '⚠️ This action must be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (!selected) {
    await interaction.reply({
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

    await interaction.update({
      content: message,
      components: [],
    });
    return;
  }

  await interaction.update({
    content: `✅ Restored **${result.character.name}** as a private character and made them active. Use \`/view-character\` to review them.`,
    components: [],
  });
}
