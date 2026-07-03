import {
  ChannelType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { LifecycleNotificationChannelDAO } from '../dao/lifecycle_notification_channel.dao';

const lifecycleNotificationChannelDAO = new LifecycleNotificationChannelDAO();

export const data = new SlashCommandBuilder()
  .setName('bot-announcements')
  .setDescription('Configure operational bot announcements for this server.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('set')
      .setDescription('Register the channel used for bot lifecycle announcements.')
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('The channel to use for bot restart and lifecycle notices.')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('clear')
      .setDescription('Disable bot lifecycle announcements for this server.'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('status')
      .setDescription('Show the current bot announcement channel for this server.'),
  );

module.exports = {
  data,
  async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.reply({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === 'set') {
      const channel = interaction.options.getChannel('channel', true);

      if (!('guildId' in channel) || channel.guildId !== guildId) {
        return interaction.reply({
          content: 'That channel must belong to this server.',
          ephemeral: true,
        });
      }

      await lifecycleNotificationChannelDAO.upsert({
        guildId,
        channelId: channel.id,
        updatedBy: interaction.user.id,
      });

      return interaction.reply({
        content: `Bot announcements will now be posted in ${channel}.`,
        ephemeral: true,
      });
    }

    if (subcommand === 'clear') {
      await lifecycleNotificationChannelDAO.clear(guildId);
      return interaction.reply({
        content: 'Bot announcements are now disabled for this server.',
        ephemeral: true,
      });
    }

    if (subcommand === 'status') {
      const row = await lifecycleNotificationChannelDAO.findByGuild(guildId);
      return interaction.reply({
        content: row
          ? `Bot announcements are currently set to <#${row.channel_id}>.`
          : 'Bot announcements are currently disabled for this server.',
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: 'Unknown bot announcements command.',
      ephemeral: true,
    });
  },
};
