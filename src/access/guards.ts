// src/access/guards.ts
import type {
  ButtonInteraction,
  CommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { CommandPolicy } from './features';
import { ComponentPolicy } from './components_policy';
import { authorizeInteraction } from './authorize';

const UPGRADE_MSG =
  '⚠️ This feature requires an active server subscription. Ask a server admin to enable it or visit the bot’s upgrade page.';
const NEED_GUILD_MSG =
  '⚠️ This action only works in a server. Please use this in a Discord server where the bot is installed.';

export async function guardCommand(interaction: CommandInteraction): Promise<true | string> {
  console.debug(`[GuardCommand] command=${interaction.commandName} user=${interaction.user.id}`);

  const requiredFeature = CommandPolicy[interaction.commandName];
  if (!requiredFeature) {
    console.debug(`[GuardCommand] No gating policy → allowed`);
    return true; // no gate for this command
  }
  console.debug(`[GuardCommand] Required feature=${requiredFeature}`);

  const guildId = interaction.guild?.id ?? null;
  if (!guildId) {
    console.debug(`[GuardCommand] No guildId → NEED_GUILD_MSG`);
    return NEED_GUILD_MSG;
  }

  const member = interaction.guild?.members?.me
    ? await interaction.guild.members.fetch(interaction.user.id).catch((err) => {
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

  return res.ok ? true : UPGRADE_MSG;
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
  console.debug(`[GuardComponent] Required feature=${requiredFeature}`);

  const guildId = interaction.guild?.id ?? null;
  if (!guildId) {
    console.debug(`[GuardComponent] No guildId → NEED_GUILD_MSG`);
    return NEED_GUILD_MSG;
  }

  const member = interaction.guild?.members?.me
    ? await interaction.guild.members.fetch(interaction.user.id).catch((err) => {
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

  return res.ok ? true : UPGRADE_MSG;
}
