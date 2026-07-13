import type { CacheType, ChatInputCommandInteraction, Client, Interaction } from 'discord.js';

import {
  hasSupportVerificationMatch,
  type SupportVerificationResult,
} from '../services/support_verification.service';

type GuildLookupContext = ChatInputCommandInteraction<CacheType> | Interaction | { client: Client };

export async function buildSupportVerificationMessage(
  context: GuildLookupContext,
  result: SupportVerificationResult,
): Promise<string> {
  if (!hasSupportVerificationMatch(result)) {
    return '❌ No active subscription or game membership found. If you just subscribed, try again in a few minutes.';
  }

  const lines: string[] = [];

  if (result.subscriberGuildIds.length) {
    lines.push(
      `✅ Verified as **Subscriber** — you have an active subscription on ${await guildNames(
        context,
        result.subscriberGuildIds,
      )}`,
    );
  }

  if (result.playerGuilds.length) {
    lines.push(
      `✅ Verified as **Player** — you're in a game on ${await guildNames(
        context,
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

async function guildNames(context: GuildLookupContext, guildIds: string[]): Promise<string> {
  const uniqueGuildIds = [...new Set(guildIds)];
  const names = await Promise.all(
    uniqueGuildIds.map(async (guildId) => {
      const cached = context.client.guilds.cache.get(guildId);
      if (cached) return cached.name;

      const fetched = await context.client.guilds.fetch(guildId).catch(() => null);
      return fetched?.name ?? guildId;
    }),
  );

  return names.map((name) => `**${name}**`).join(', ');
}
