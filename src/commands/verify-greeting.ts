import {
  CacheType,
  ChannelType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from 'discord.js';

import { buildGreeting } from '../components/support_verify_button';
import { supportGuildId } from '../config/env_config';

const OWNER_IDS = new Set<string>([(process.env.OWNER_DISCORD_ID ?? '').trim()].filter(Boolean));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify-greeting')
    .setDescription('Post the support server verification greeting in a channel.')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel where SPRITE should post the verification greeting')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    if (!OWNER_IDS.has(interaction.user.id)) {
      return interaction.reply({ content: '⛔ Not authorized.', ephemeral: true });
    }

    if (!interaction.guild || interaction.guildId !== supportGuildId) {
      return interaction.reply({
        content: 'Use `/verify-greeting` in the SPRITEbot support server.',
        ephemeral: true,
      });
    }

    const channel = interaction.options.getChannel('channel', true);
    if (channel.type !== ChannelType.GuildText) {
      return interaction.reply({
        content: 'Choose a text channel for the verification greeting.',
        ephemeral: true,
      });
    }

    const message = await (channel as TextChannel).send(buildGreeting());

    return interaction.reply({
      content: `✅ Sent the verification greeting to ${message.url}`,
      ephemeral: true,
    });
  },
};
