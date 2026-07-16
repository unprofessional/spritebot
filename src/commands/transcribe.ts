import {
  CacheType,
  ChannelType,
  ChatInputCommandInteraction,
  GuildTextBasedChannel,
  SlashCommandBuilder,
  VoiceBasedChannel,
} from 'discord.js';

import { PlayerDAO } from '../dao/player.dao';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';
import {
  formatMissingTranscriptionPermissions,
  getMissingTranscriptionPermissions,
} from '../voice/transcription_permissions';
import { voiceManager } from '../voice/voice_manager';

const playerDAO = new PlayerDAO();
const TRANSCRIBE_ADMIN_USER_IDS = new Set<string>(['818606180095885332']);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('transcribe')
    .setDescription('Manage voice transcription for this server.')
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Join a voice channel and record a transcript for dump-on-stop.')
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

  interactionPolicy: {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  } satisfies InteractionDispatchPolicy,

  async execute(
    interaction: ChatInputCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    if (!interaction.guild) {
      return responder.respond({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    if (!(await isServerGm(interaction.user.id, interaction.guild.id))) {
      return responder.respond({
        content: '⚠️ Only a GM can manage transcription sessions.',
        ephemeral: true,
      });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'start') {
      const voiceChannel = interaction.options.getChannel('voice-channel', true);
      const textChannel = interaction.options.getChannel('text-channel', true);

      if (
        (voiceChannel.type !== ChannelType.GuildVoice &&
          voiceChannel.type !== ChannelType.GuildStageVoice) ||
        !('joinable' in voiceChannel)
      ) {
        return responder.respond({ content: '⚠️ Choose a voice channel I can join.' });
      }

      if (
        textChannel.type !== ChannelType.GuildText &&
        textChannel.type !== ChannelType.GuildAnnouncement &&
        textChannel.type !== ChannelType.PublicThread &&
        textChannel.type !== ChannelType.PrivateThread &&
        textChannel.type !== ChannelType.AnnouncementThread
      ) {
        return responder.respond({
          content: '⚠️ Choose a text channel for transcript output.',
        });
      }

      const missingPermissions = await getMissingTranscriptionPermissions(
        interaction.guild,
        voiceChannel as VoiceBasedChannel,
        textChannel as GuildTextBasedChannel,
      );
      if (missingPermissions.length > 0) {
        return responder.respond({
          content: formatMissingTranscriptionPermissions(missingPermissions),
        });
      }

      const status = await voiceManager.start({
        client: interaction.client,
        guild: interaction.guild,
        voiceChannel: voiceChannel as VoiceBasedChannel,
        textChannel: textChannel as GuildTextBasedChannel,
      });

      return responder.respond({
        content: `✅ Transcription started in <#${status.voiceChannelId}>. A raw .txt transcript will be posted in <#${status.textChannelId}> when the session stops.`,
      });
    }

    if (subcommand === 'stop') {
      const result = await voiceManager.stop(interaction.guild.id);
      if (!result.stopped) {
        return responder.respond({ content: '⚠️ No transcription session is active.' });
      }

      if (result.final) {
        return responder.respond({
          content: `✅ Transcription stopped. Dumped ${result.segmentCount} segment(s) from ${result.participantCount} participant(s).`,
        });
      }

      return responder.respond({
        content: `✅ Transcription stopped. Posted a partial transcript with ${result.segmentCount} completed segment(s); ${result.pendingCount} segment(s) are still processing and a final transcript will be posted when the drain finishes or times out.`,
      });
    }

    const status = voiceManager.status(interaction.guild.id);
    if (!status) {
      return responder.respond({
        content: '⚠️ No transcription session is active.',
        ephemeral: true,
      });
    }

    return responder.respond({
      content: `✅ Active in <#${status.voiceChannelId}> → <#${status.textChannelId}>. Segments transcribed: ${status.segmentsTranscribed}. Participants: ${status.participantCount}.`,
      ephemeral: true,
    });
  },
};

async function isServerGm(userId: string, guildId: string): Promise<boolean> {
  if (TRANSCRIBE_ADMIN_USER_IDS.has(userId)) return true;

  const link = await playerDAO.getServerLink(userId, guildId);
  return link?.role === 'gm';
}
