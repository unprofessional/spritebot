import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import {
  getPrivateCharacterAudit,
  type PrivateCharacterAuditRow,
} from '../services/admin_housekeeping.service';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';

function formatCharacter(row: PrivateCharacterAuditRow): string {
  const abandonedDraft = row.hasNoFilledStats ? ' ⚠️ no filled stats' : '';
  return [
    `Game: **${row.gameName}**`,
    `Owner: \`${row.ownerId}\``,
    `Stats filled: **${row.filledStatCount}/${row.totalStatCount}**${abandonedDraft}`,
    `Created: ${row.createdAt}`,
  ].join('\n');
}

export async function handleAdminCharacters(
  interaction: ChatInputCommandInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const guildId = interaction.guildId;
  const gameId = interaction.options.getString('game_id');

  if (!guildId) {
    await responder.respond({
      content: '⚠️ This command must be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const rows = await getPrivateCharacterAudit({ guildId, gameId });

  if (!rows.length) {
    await responder.respond({
      content: '✅ No private characters found for that scope.',
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('SPRITEbot Private Character Audit')
    .setDescription(`Found ${rows.length} private character(s).`)
    .setColor(0xaa66cc)
    .setTimestamp(new Date());

  for (const row of rows.slice(0, 25)) {
    embed.addFields({
      name: row.name,
      value: formatCharacter(row).slice(0, 1024),
      inline: false,
    });
  }

  if (rows.length > 25) {
    embed.setFooter({ text: `Showing 25 of ${rows.length} private characters.` });
  }

  await responder.respond({ embeds: [embed], ephemeral: true });
}
