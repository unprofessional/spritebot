import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getGameAudit, type GameAuditRow } from '../services/admin_housekeeping.service';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';

function formatGame(row: GameAuditRow): string {
  const visibility = row.isPublic ? 'Public' : 'Private';
  const stale = row.inactiveOver60Days ? ' ⚠️ inactive 60+ days' : '';
  return [
    `Status: **${visibility}**${stale}`,
    `GM: \`${row.createdBy}\``,
    `Stats: **${row.statTemplateCount}**`,
    `Characters: **${row.characterCount}** (${row.publicCharacterCount} public / ${row.privateCharacterCount} private)`,
    `Last activity: ${row.lastActivityAt}`,
  ].join('\n');
}

export async function handleAdminGames(
  interaction: ChatInputCommandInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await responder.respond({
      content: '⚠️ This command must be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const rows = await getGameAudit(guildId);

  if (!rows.length) {
    await responder.respond({
      content: '📭 No games found in this server.',
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('SPRITEbot Game Audit')
    .setDescription(`Found ${rows.length} game(s) in this server.`)
    .setColor(0x33b5e5)
    .setTimestamp(new Date());

  for (const row of rows.slice(0, 25)) {
    embed.addFields({
      name: row.name,
      value: formatGame(row).slice(0, 1024),
      inline: false,
    });
  }

  if (rows.length > 25) {
    embed.setFooter({ text: `Showing 25 of ${rows.length} games.` });
  }

  await responder.respond({ embeds: [embed], ephemeral: true });
}
