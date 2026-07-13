import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { supportGuildId } from '../config/env_config';
import {
  hasSupportVerificationMatch,
  verifySupportMember,
  type SupportVerificationResult,
} from '../services/support_verification.service';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verify your SPRITEbot subscription or player status in the support server.'),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    if (!interaction.guild || interaction.guildId !== supportGuildId) {
      return interaction.reply({
        content: 'Use `/verify` in the SPRITEbot support server.',
        ephemeral: true,
      });
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const result = await verifySupportMember(member);

    return interaction.reply({
      content: await verificationMessage(interaction, result),
      ephemeral: true,
    });
  },
};

async function verificationMessage(
  interaction: ChatInputCommandInteraction<CacheType>,
  result: SupportVerificationResult,
): Promise<string> {
  if (!hasSupportVerificationMatch(result)) {
    return '❌ No active subscription or game membership found. If you just subscribed, try again in a few minutes.';
  }

  const lines: string[] = [];

  if (result.subscriberGuildIds.length) {
    lines.push(
      `✅ Verified as **Subscriber** — you have an active subscription on ${await guildNames(
        interaction,
        result.subscriberGuildIds,
      )}`,
    );
  }

  if (result.playerGuilds.length) {
    lines.push(
      `✅ Verified as **Player** — you're in a game on ${await guildNames(
        interaction,
        result.playerGuilds.map((row) => row.guild_id),
      )}`,
    );
  }

  if (result.assignedRoleIds.length) {
    lines.push('Your support server roles have been updated.');
  }

  if (result.missingRoleIds.length) {
    lines.push(
      'Role assignment is not fully configured yet. Ask a server admin to check role IDs.',
    );
  }

  return lines.join('\n');
}

async function guildNames(
  interaction: ChatInputCommandInteraction<CacheType>,
  guildIds: string[],
): Promise<string> {
  const uniqueGuildIds = [...new Set(guildIds)];
  const names = await Promise.all(
    uniqueGuildIds.map(async (guildId) => {
      const cached = interaction.client.guilds.cache.get(guildId);
      if (cached) return cached.name;

      const fetched = await interaction.client.guilds.fetch(guildId).catch(() => null);
      return fetched?.name ?? guildId;
    }),
  );

  return names.map((name) => `**${name}**`).join(', ');
}
