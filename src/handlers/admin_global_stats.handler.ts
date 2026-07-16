import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getGlobalStats } from '../services/admin_housekeeping.service';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

export async function handleAdminGlobalStats(
  interaction: ChatInputCommandInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const stats = await getGlobalStats();
  const botGuilds = interaction.client.guilds.cache.size;

  const embed = new EmbedBuilder()
    .setTitle('SPRITEbot Global Stats')
    .setColor(0x33b5e5)
    .addFields(
      {
        name: 'Servers',
        value: formatNumber(botGuilds),
        inline: true,
      },
      {
        name: 'Subscribers',
        value: formatNumber(stats.activeSubscriberGuilds),
        inline: true,
      },
      {
        name: 'Gifted Subs',
        value: formatNumber(stats.activeGiftedGuilds),
        inline: true,
      },
      {
        name: 'Access Guilds',
        value: formatNumber(stats.activeAccessGuilds),
        inline: true,
      },
      {
        name: 'Public Games',
        value: `${formatNumber(stats.publicGames)} / ${formatNumber(stats.totalGames)} total`,
        inline: true,
      },
      {
        name: 'Public Characters',
        value: `${formatNumber(stats.publicCharacters)} / ${formatNumber(
          stats.totalActiveCharacters,
        )} active`,
        inline: true,
      },
      {
        name: 'Linked Players',
        value: formatNumber(stats.linkedPlayers),
        inline: true,
      },
    )
    .setTimestamp(new Date());

  await responder.respond({ embeds: [embed], ephemeral: true });
}
