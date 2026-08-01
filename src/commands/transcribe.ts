import {
  AutocompleteInteraction,
  CacheType,
  ChannelType,
  ChatInputCommandInteraction,
  GuildBasedChannel,
  GuildMember,
  GuildTextBasedChannel,
  PermissionFlagsBits,
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
import { defineDiscordOperationPolicy } from '../discord/operation_policy';
import { executeDiscordSdkMethodAs } from '../discord/sdk_operations';
import {
  buildChannelAutocompleteChoices,
  type ChannelAutocompleteCandidate,
} from '../utils/channel_autocomplete';

const playerDAO = new PlayerDAO();
const TRANSCRIBE_ADMIN_USER_IDS = new Set<string>(['818606180095885332']);
const autocompleteMemberReadPolicy = defineDiscordOperationPolicy({
  operation: 'transcribe.autocomplete.fetch-member',
  timeoutMs: 750,
  totalBudgetMs: 1_000,
  retry: 'never',
  maxAttempts: 1,
});
const channelReadPolicy = defineDiscordOperationPolicy({
  operation: 'transcribe.fetch-channel',
  timeoutMs: 1_500,
  totalBudgetMs: 4_000,
  retry: 'safe-read',
  maxAttempts: 2,
});
const memberReadPolicy = defineDiscordOperationPolicy({
  operation: 'transcribe.fetch-member',
  timeoutMs: 1_500,
  totalBudgetMs: 4_000,
  retry: 'safe-read',
  maxAttempts: 2,
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName('transcribe')
    .setDescription('Manage voice transcription for this server.')
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Join a voice channel and record a transcript for dump-on-stop.')
        .addStringOption((option) =>
          option
            .setName('voice-channel')
            .setDescription('Voice channel to transcribe.')
            .setAutocomplete(true)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('text-channel')
            .setDescription('Text channel for rough transcript output.')
            .setAutocomplete(true)
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

  async autocomplete(interaction: AutocompleteInteraction) {
    if (!interaction.guild) return [];
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'voice-channel' && focused.name !== 'text-channel') return [];

    const member =
      interaction.guild.members.cache.get(interaction.user.id) ??
      (await executeDiscordSdkMethodAs<GuildMember>(
        autocompleteMemberReadPolicy,
        interaction.guild.members,
        'fetch',
        interaction.user.id,
      ).catch(() => null));
    if (!member) return [];

    const candidates: ChannelAutocompleteCandidate[] = [];
    for (const channel of interaction.guild.channels.cache.values()) {
      const kind = channelKindForOption(channel.type, focused.name);
      if (!kind || !channel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel)) continue;
      candidates.push({
        id: channel.id,
        name: channel.name,
        kind,
        parentName: 'parent' in channel ? channel.parent?.name : null,
      });
    }
    return buildChannelAutocompleteChoices(candidates, String(focused.value));
  },

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
      const voiceChannelId = parseChannelId(interaction.options.getString('voice-channel', true));
      const textChannelId = parseChannelId(interaction.options.getString('text-channel', true));
      if (!voiceChannelId || !textChannelId) {
        return responder.respond({
          content: '⚠️ Choose the voice and text channels from the suggestions.',
        });
      }
      const [voiceChannel, textChannel, invokingMember] = await Promise.all([
        executeDiscordSdkMethodAs<GuildBasedChannel>(
          channelReadPolicy,
          interaction.guild.channels,
          'fetch',
          voiceChannelId,
        ).catch(() => null),
        executeDiscordSdkMethodAs<GuildBasedChannel>(
          channelReadPolicy,
          interaction.guild.channels,
          'fetch',
          textChannelId,
        ).catch(() => null),
        executeDiscordSdkMethodAs<GuildMember>(
          memberReadPolicy,
          interaction.guild.members,
          'fetch',
          interaction.user.id,
        ).catch(() => null),
      ]);

      if (
        !voiceChannel ||
        (voiceChannel.type !== ChannelType.GuildVoice &&
          voiceChannel.type !== ChannelType.GuildStageVoice) ||
        !('joinable' in voiceChannel) ||
        !invokingMember ||
        !voiceChannel.permissionsFor(invokingMember).has(PermissionFlagsBits.ViewChannel)
      ) {
        return responder.respond({ content: '⚠️ Choose a voice channel I can join.' });
      }

      if (
        !textChannel ||
        (textChannel.type !== ChannelType.GuildText &&
          textChannel.type !== ChannelType.GuildAnnouncement &&
          textChannel.type !== ChannelType.PublicThread &&
          textChannel.type !== ChannelType.PrivateThread &&
          textChannel.type !== ChannelType.AnnouncementThread) ||
        !invokingMember ||
        !textChannel.permissionsFor(invokingMember).has(PermissionFlagsBits.ViewChannel)
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
        startedBy: interaction.user.id,
      });

      if (status.processingPreviousSession) {
        return responder.respond({
          content: `⏳ The previous transcription session in <#${status.voiceChannelId}> is still processing its remaining segments. A new session can start after its final transcript is posted.`,
        });
      }

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
        content: `✅ Transcription stopped. Posted a partial transcript with ${result.segmentCount} completed segment(s); ${result.pendingCount} segment(s) are still processing and a final transcript will be posted when processing finishes.`,
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
      content: status.processingPreviousSession
        ? `⏳ Processing remaining segments from the previous transcription session in <#${status.voiceChannelId}>. Segments transcribed: ${status.segmentsTranscribed}. Captures dropped: ${status.droppedCaptureCount}.`
        : `✅ Active in <#${status.voiceChannelId}> → <#${status.textChannelId}>. Segments transcribed: ${status.segmentsTranscribed}. Participants: ${status.participantCount}. Captures dropped: ${status.droppedCaptureCount}.`,
      ephemeral: true,
    });
  },
};

function channelKindForOption(
  type: ChannelType,
  optionName: 'voice-channel' | 'text-channel',
): 'Voice' | 'Text' | null {
  if (
    optionName === 'voice-channel' &&
    (type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice)
  ) {
    return 'Voice';
  }
  if (
    optionName === 'text-channel' &&
    (type === ChannelType.GuildText ||
      type === ChannelType.GuildAnnouncement ||
      type === ChannelType.PublicThread ||
      type === ChannelType.PrivateThread ||
      type === ChannelType.AnnouncementThread)
  ) {
    return 'Text';
  }
  return null;
}

function parseChannelId(value: string): string | null {
  const match = value.trim().match(/^(?:<#(\d{17,20})>|(\d{17,20}))$/);
  return match?.[1] ?? match?.[2] ?? null;
}

async function isServerGm(userId: string, guildId: string): Promise<boolean> {
  if (TRANSCRIBE_ADMIN_USER_IDS.has(userId)) return true;

  const link = await playerDAO.getServerLink(userId, guildId);
  return link?.role === 'gm';
}
