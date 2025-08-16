// src/access/guards.ts
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
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

export async function guardSlash(interaction: ChatInputCommandInteraction): Promise<true | string> {
  const requiredFeature = CommandPolicy[interaction.commandName];
  if (!requiredFeature) return true; // no gate for this command

  const guildId = interaction.guild?.id ?? null;
  if (!guildId) return NEED_GUILD_MSG;

  const member = interaction.guild?.members?.me
    ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null)
    : null;

  const res = await authorizeInteraction(
    {
      feature: requiredFeature,
      guildId,
      userId: interaction.user.id,
    },
    member,
  );

  return res.ok ? true : UPGRADE_MSG;
}

export async function guardComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
): Promise<true | string> {
  // Match by prefix
  const match = ComponentPolicy.find(([p]) => interaction.customId.startsWith(p));
  if (!match) return true; // not gated

  const [, requiredFeature] = match;

  const guildId = interaction.guild?.id ?? null;
  if (!guildId) return NEED_GUILD_MSG;

  const member = interaction.guild?.members?.me
    ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null)
    : null;

  const res = await authorizeInteraction(
    {
      feature: requiredFeature,
      guildId,
      userId: interaction.user.id,
    },
    member,
  );

  return res.ok ? true : UPGRADE_MSG;
}
