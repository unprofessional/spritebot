// src/access/guards.ts
import type {
  ButtonInteraction,
  CommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  GuildMember,
} from 'discord.js';
import { defineDiscordOperationPolicy } from '../discord/operation_policy';
import { executeDiscordSdkMethodAs } from '../discord/sdk_operations';
import { CommandPolicy } from './features';
import { ComponentPolicy } from './components_policy';
import { authorizeInteraction } from './authorize';

export const UPGRADE_MSG =
  '⚠️ This feature requires an active server subscription. Ask a server admin to enable it or visit the bot’s upgrade page.';
export const NEED_GUILD_MSG =
  '⚠️ This action only works in a server. Please use this in a Discord server where the bot is installed.';
export const AUTHORIZATION_UNAVAILABLE_MSG =
  'I couldn’t verify this server’s access with Discord right now. Nothing was changed. Please try again in a moment.';

function denialMessage(
  reason: Exclude<Awaited<ReturnType<typeof authorizeInteraction>>, { ok: true }>['reason'],
): string {
  return reason === 'AUTHORIZATION_UNAVAILABLE' ? AUTHORIZATION_UNAVAILABLE_MSG : UPGRADE_MSG;
}

const authorizationMemberReadPolicy = defineDiscordOperationPolicy({
  operation: 'authorization.fetch-member',
  timeoutMs: 800,
  totalBudgetMs: 2_000,
  retry: 'safe-read',
  maxAttempts: 2,
});

export async function guardCommand(interaction: CommandInteraction): Promise<true | string> {
  console.debug(`[GuardCommand] command=${interaction.commandName} user=${interaction.user.id}`);

  const requiredFeature = CommandPolicy[interaction.commandName];
  if (!requiredFeature) {
    console.debug(`[GuardCommand] No gating policy → allowed`);
    return true; // no gate for this command
  }
  if (requiredFeature === 'public') {
    console.debug(`[GuardCommand] Explicit public policy → allowed`);
    return true;
  }
  console.debug(`[GuardCommand] Required feature=${requiredFeature}`);

  const guildId = interaction.guild?.id ?? null;
  if (!guildId) {
    console.debug(`[GuardCommand] No guildId → NEED_GUILD_MSG`);
    return NEED_GUILD_MSG;
  }

  const member = interaction.guild?.members?.me
    ? await executeDiscordSdkMethodAs<GuildMember>(
        authorizationMemberReadPolicy,
        interaction.guild.members,
        'fetch',
        interaction.user.id,
      ).catch((err) => {
        console.warn(`[GuardCommand] Failed to fetch member:`, err);
        return null;
      })
    : null;

  console.debug(`[GuardCommand] Authorizing feature=${requiredFeature} guild=${guildId}`);

  const res = await authorizeInteraction(
    {
      feature: requiredFeature,
      guildId,
      userId: interaction.user.id,
    },
    member,
  );

  console.debug(`[GuardCommand] Auth result ok=${res.ok}`);

  return res.ok ? true : denialMessage(res.reason);
}

export async function guardComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
): Promise<true | string> {
  console.debug(`[GuardComponent] customId=${interaction.customId} user=${interaction.user.id}`);

  // Match by prefix
  const match = ComponentPolicy.find(([p]) => interaction.customId.startsWith(p));
  if (!match) {
    console.debug(`[GuardComponent] No matching component policy → allowed`);
    return true; // not gated
  }

  const [, requiredFeature] = match;
  if (requiredFeature === 'public') {
    console.debug(`[GuardComponent] Explicit public policy → allowed`);
    return true;
  }
  console.debug(`[GuardComponent] Required feature=${requiredFeature}`);

  const guildId = interaction.guild?.id ?? null;
  if (!guildId) {
    console.debug(`[GuardComponent] No guildId → NEED_GUILD_MSG`);
    return NEED_GUILD_MSG;
  }

  const member = interaction.guild?.members?.me
    ? await executeDiscordSdkMethodAs<GuildMember>(
        authorizationMemberReadPolicy,
        interaction.guild.members,
        'fetch',
        interaction.user.id,
      ).catch((err) => {
        console.warn(`[GuardComponent] Failed to fetch member:`, err);
        return null;
      })
    : null;

  console.debug(`[GuardComponent] Authorizing feature=${requiredFeature} guild=${guildId}`);

  const res = await authorizeInteraction(
    {
      feature: requiredFeature,
      guildId,
      userId: interaction.user.id,
    },
    member,
  );

  console.debug(`[GuardComponent] Auth result ok=${res.ok}`);

  return res.ok ? true : denialMessage(res.reason);
}
