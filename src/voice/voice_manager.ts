import {
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import {
  AttachmentBuilder,
  ChannelType,
  Channel,
  Client,
  Events,
  Guild,
  GuildTextBasedChannel,
  PermissionFlagsBits,
  VoiceState,
  VoiceBasedChannel,
} from 'discord.js';

import { AudioReceiver } from './audio_receiver';
import type { SpeechSegment } from './segment_buffer';
import { TranscriptionClient } from './transcription_client';
import { encodePcm16MonoWav } from './wav';

export type StartTranscriptionParams = {
  client: Client;
  guild: Guild;
  voiceChannel: VoiceBasedChannel;
  textChannel: GuildTextBasedChannel;
};

export type VoiceSessionStatus = {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  startedAt: Date;
  segmentsTranscribed: number;
  participantCount: number;
};

export type StopTranscriptionResult = {
  stopped: boolean;
  segmentCount: number;
  participantCount: number;
  autoStopped: boolean;
};

type VoiceSession = VoiceSessionStatus & {
  client: Client;
  connection: VoiceConnection;
  receiver: AudioReceiver;
  transcript: TranscriptEntry[];
  participants: Set<string>;
  speakerIdentities: Map<string, SpeakerIdentity>;
  pendingTranscriptions: Set<Promise<void>>;
  isStopping: boolean;
};

type SpeakerIdentity = {
  displayName: string;
  isBot: boolean;
};

type TranscriptEntry = {
  userId: string;
  displayName: string;
  timestamp: Date;
  text: string;
};

export class VoiceManager {
  private readonly sessions = new Map<string, VoiceSession>();
  private readonly transcriptionClient = new TranscriptionClient();
  private installedClient: Client | null = null;

  install(client: Client): void {
    if (this.installedClient) return;
    this.installedClient = client;
    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      void this.handleVoiceStateUpdate(oldState, newState);
    });
  }

  async start(params: StartTranscriptionParams): Promise<VoiceSessionStatus> {
    this.install(params.client);

    const existing = this.sessions.get(params.guild.id);
    if (existing) return toStatus(existing);

    const botMember = params.guild.members.me ?? (await params.guild.members.fetchMe());
    const permissions = params.voiceChannel.permissionsFor(botMember);
    if (
      !permissions?.has(PermissionFlagsBits.Connect) ||
      !permissions.has(PermissionFlagsBits.Speak)
    ) {
      throw new Error('I need Connect and Speak permissions in that voice channel.');
    }

    const connection = joinVoiceChannel({
      channelId: params.voiceChannel.id,
      guildId: params.guild.id,
      adapterCreator: params.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    const session: VoiceSession = {
      client: params.client,
      guildId: params.guild.id,
      voiceChannelId: params.voiceChannel.id,
      textChannelId: params.textChannel.id,
      startedAt: new Date(),
      segmentsTranscribed: 0,
      participantCount: 0,
      connection,
      receiver: new AudioReceiver(connection, (userId, segment) =>
        this.queueTranscription(session, userId, segment),
      ),
      transcript: [],
      participants: new Set(),
      speakerIdentities: new Map(),
      pendingTranscriptions: new Set(),
      isStopping: false,
    };

    session.receiver.start();
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      this.sessions.delete(params.guild.id);
    });

    this.sessions.set(params.guild.id, session);
    return toStatus(session);
  }

  async stop(guildId: string): Promise<StopTranscriptionResult> {
    return this.stopAndDump(guildId, { autoStopped: false });
  }

  async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const session = this.sessions.get(oldState.guild.id);
    if (!session || session.isStopping) return;

    const touchedSessionChannel =
      oldState.channelId === session.voiceChannelId ||
      newState.channelId === session.voiceChannelId;
    if (!touchedSessionChannel) return;

    await new Promise((resolve) => setTimeout(resolve, 1_500));
    if (this.hasNonBotMembers(oldState.guild, session.voiceChannelId)) return;

    await this.stopAndDump(session.guildId, { autoStopped: true });
  }

  private async stopAndDump(
    guildId: string,
    { autoStopped }: { autoStopped: boolean },
  ): Promise<StopTranscriptionResult> {
    const session = this.sessions.get(guildId);
    if (!session) {
      getVoiceConnection(guildId)?.destroy();
      return { stopped: false, segmentCount: 0, participantCount: 0, autoStopped };
    }

    session.isStopping = true;
    session.connection.destroy();
    await Promise.allSettled([...session.pendingTranscriptions]);
    await this.sendTranscriptDump(session, autoStopped);
    this.sessions.delete(guildId);

    return {
      stopped: true,
      segmentCount: session.transcript.length,
      participantCount: session.participants.size,
      autoStopped,
    };
  }

  status(guildId: string): VoiceSessionStatus | null {
    const session = this.sessions.get(guildId);
    return session ? toStatus(session) : null;
  }

  private queueTranscription(session: VoiceSession, userId: string, segment: SpeechSegment): void {
    const task = this.transcribeSegment(session, userId, segment)
      .catch((err) => {
        console.error(`[voice] transcription failed guild=${session.guildId} user=${userId}`, err);
      })
      .finally(() => {
        session.pendingTranscriptions.delete(task);
      });

    session.pendingTranscriptions.add(task);
  }

  private async transcribeSegment(
    session: VoiceSession,
    userId: string,
    segment: SpeechSegment,
  ): Promise<void> {
    const speaker = await this.getSpeakerIdentity(session, userId);
    if (speaker.isBot) return;

    const wav = encodePcm16MonoWav(segment.pcm);
    const result = await this.transcriptionClient.transcribeWav(
      wav,
      `${session.guildId}-${userId}-${segment.startedAt.getTime()}.wav`,
    );
    if (!result.text) return;

    session.participants.add(userId);
    session.participantCount = session.participants.size;
    session.segmentsTranscribed += 1;
    session.transcript.push({
      userId,
      displayName: speaker.displayName,
      timestamp: segment.startedAt,
      text: result.text,
    });
  }

  private async getSpeakerIdentity(
    session: VoiceSession,
    userId: string,
  ): Promise<SpeakerIdentity> {
    const cached = session.speakerIdentities.get(userId);
    if (cached) return cached;

    const member = await session.client.guilds.cache
      .get(session.guildId)
      ?.members.fetch(userId)
      .catch(() => null);
    const user = member?.user ?? (await session.client.users.fetch(userId).catch(() => null));
    const identity = {
      displayName: member?.displayName ?? user?.displayName ?? user?.username ?? userId,
      isBot: member?.user.bot ?? user?.bot ?? false,
    };

    session.speakerIdentities.set(userId, identity);
    return identity;
  }

  private async sendTranscriptDump(session: VoiceSession, autoStopped: boolean): Promise<void> {
    const channel = await session.client.channels.fetch(session.textChannelId).catch(() => null);
    if (!isTextOutputChannel(channel)) return;

    const endedAt = new Date();
    const transcript = formatTranscript(session, endedAt);
    const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf8'), {
      name: `transcript-${session.guildId}-${session.startedAt.toISOString().replace(/[:.]/g, '-')}.txt`,
    });

    await channel.send({
      content: [
        autoStopped
          ? 'Transcription stopped because the voice channel emptied.'
          : 'Transcription stopped.',
        `Duration: ${formatDuration(endedAt.getTime() - session.startedAt.getTime())}`,
        `Participants: ${session.participants.size}`,
        `Segments: ${session.transcript.length}`,
      ].join('\n'),
      files: [attachment],
    });
  }

  private hasNonBotMembers(guild: Guild, channelId: string): boolean {
    const channel = guild.channels.cache.get(channelId);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)
    ) {
      return true;
    }

    return channel.members.some((member) => !member.user.bot);
  }
}

function isTextOutputChannel(channel: Channel | null): channel is GuildTextBasedChannel {
  return Boolean(
    channel &&
      (channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement ||
        channel.type === ChannelType.PublicThread ||
        channel.type === ChannelType.PrivateThread ||
        channel.type === ChannelType.AnnouncementThread),
  );
}

function toStatus(session: VoiceSession): VoiceSessionStatus {
  return {
    guildId: session.guildId,
    voiceChannelId: session.voiceChannelId,
    textChannelId: session.textChannelId,
    startedAt: session.startedAt,
    segmentsTranscribed: session.segmentsTranscribed,
    participantCount: session.participants.size,
  };
}

export const voiceManager = new VoiceManager();

export function initializeVoiceTranscription(client: Client): void {
  voiceManager.install(client);
}

function formatTranscript(session: VoiceSession, endedAt: Date): string {
  const sorted = [...session.transcript].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );

  const lines = [
    'SPRITEbot Voice Transcript',
    `Voice channel: ${session.voiceChannelId}`,
    `Text channel: ${session.textChannelId}`,
    `Started: ${session.startedAt.toISOString()}`,
    `Ended: ${endedAt.toISOString()}`,
    `Duration: ${formatDuration(endedAt.getTime() - session.startedAt.getTime())}`,
    `Participants: ${session.participants.size}`,
    `Segments: ${sorted.length}`,
    '',
  ];

  if (sorted.length === 0) {
    lines.push('(No speech segments were transcribed.)');
    return `${lines.join('\n')}\n`;
  }

  for (const entry of sorted) {
    lines.push(
      `[${formatOffset(entry.timestamp.getTime() - session.startedAt.getTime())}] ${entry.displayName}: ${entry.text}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

function formatOffset(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function formatDuration(ms: number): string {
  return formatOffset(ms);
}
