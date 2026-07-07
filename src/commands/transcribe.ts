import {
  CacheType,
  ChannelType,
  ChatInputCommandInteraction,
  GuildTextBasedChannel,
  PermissionFlagsBits,
  SlashCommandBuilder,
  VoiceBasedChannel,
} from 'discord.js';

import { voiceManager } from '../voice/voice_manager';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('transcribe')
    .setDescription('Manage live voice transcription for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Join a voice channel and start sending rough live transcripts.')
        .addChannelOption((option) =>
          option
            .setName('voice-channel')
            .setDescription('Voice channel to transcribe.')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('text-channel')
            .setDescription('Text channel for rough transcript output.')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread,
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('Stop the active transcription session.'),
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Show the active transcription session.'),
    ),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    if (!interaction.guild) {
      return interaction.reply({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'start') {
      await interaction.deferReply({ ephemeral: true });
      const voiceChannel = interaction.options.getChannel('voice-channel', true);
      const textChannel = interaction.options.getChannel('text-channel', true);

      if (
        (voiceChannel.type !== ChannelType.GuildVoice &&
          voiceChannel.type !== ChannelType.GuildStageVoice) ||
        !('joinable' in voiceChannel)
      ) {
        return interaction.editReply('⚠️ Choose a voice channel I can join.');
      }

      if (
        textChannel.type !== ChannelType.GuildText &&
        textChannel.type !== ChannelType.GuildAnnouncement &&
        textChannel.type !== ChannelType.PublicThread &&
        textChannel.type !== ChannelType.PrivateThread &&
        textChannel.type !== ChannelType.AnnouncementThread
      ) {
        return interaction.editReply('⚠️ Choose a text channel for transcript output.');
      }

      const status = await voiceManager.start({
        client: interaction.client,
        guild: interaction.guild,
        voiceChannel: voiceChannel as VoiceBasedChannel,
        textChannel: textChannel as GuildTextBasedChannel,
      });

      return interaction.editReply(
        `✅ Transcription started in <#${status.voiceChannelId}>. Rough transcripts will post in <#${status.textChannelId}>.`,
      );
    }

    if (subcommand === 'stop') {
      const stopped = voiceManager.stop(interaction.guild.id);
      return interaction.reply({
        content: stopped ? '✅ Transcription stopped.' : '⚠️ No transcription session is active.',
        ephemeral: true,
      });
    }

    const status = voiceManager.status(interaction.guild.id);
    if (!status) {
      return interaction.reply({
        content: '⚠️ No transcription session is active.',
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: `✅ Active in <#${status.voiceChannelId}> → <#${status.textChannelId}>. Segments transcribed: ${status.segmentsTranscribed}.`,
      ephemeral: true,
    });
  },
};
