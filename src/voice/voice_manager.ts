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
  VoiceState,
  VoiceBasedChannel,
} from 'discord.js';

import {
  DrainInProgressError,
  isDrainInProgressError,
  isDraining,
  trackOperation,
} from '../runtime/lifecycle';
import { transcriptionConcurrency, transcriptionDrainTimeoutMs } from '../config/env_config';
import { AudioReceiver } from './audio_receiver';
import {
  createNoopTranscriptionProgressMessage,
  createTranscriptionProgressMessage,
  formatQueueSummary,
  type TranscriptionProgressMessage,
} from './progress_message';
import { SegmentSpool } from './segment_spool';
import type { SpeechSegment } from './segment_buffer';
import {
  formatDuration,
  formatTranscript,
  type TranscriptDumpKind,
  type TranscriptEntry,
} from './transcript_formatter';
import { TranscriptionClient } from './transcription_client';
import {
  formatMissingTranscriptionPermissions,
  getMissingTranscriptionPermissions,
} from './transcription_permissions';
import { TranscriptionQueue, type TranscriptionSegmentRecord } from './transcription_queue';
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
  pendingCount: number;
  failedCount: number;
  timeoutCount: number;
  final: boolean;
};

export type VoiceShutdownSummary = {
  stopped: number;
  timedOut: boolean;
  remainingSessions: number;
};

type VoiceSession = VoiceSessionStatus & {
  client: Client;
  connection: VoiceConnection;
  receiver: AudioReceiver;
  transcript: TranscriptEntry[];
  participants: Set<string>;
  speakerIdentities: Map<string, SpeakerIdentity>;
  segmentRecords: TranscriptionSegmentRecord[];
  transcriptionQueue: TranscriptionQueue;
  segmentSpool: SegmentSpool;
  pendingSpools: Set<Promise<void>>;
  isStopping: boolean;
};

type SpeakerIdentity = {
  displayName: string;
  isBot: boolean;
};

export class VoiceManager {
  private readonly sessions = new Map<string, VoiceSession>();
  private readonly transcriptionClient = new TranscriptionClient();
  private installedClient: Client | null = null;
  private checkedRecoverableSpools = false;

  install(client: Client): void {
    if (this.installedClient) return;
    this.installedClient = client;
    this.reportRecoverableSpools();
    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      void this.handleVoiceStateUpdate(oldState, newState);
    });
  }

  async start(params: StartTranscriptionParams): Promise<VoiceSessionStatus> {
    if (isDraining()) {
      throw new DrainInProgressError('SPRITEbot is restarting; voice transcription cannot start.');
    }

    this.install(params.client);

    const existing = this.sessions.get(params.guild.id);
    if (existing) return toStatus(existing);

    const missingPermissions = await getMissingTranscriptionPermissions(
      params.guild,
      params.voiceChannel,
      params.textChannel,
    );
    if (missingPermissions.length > 0) {
      throw new Error(formatMissingTranscriptionPermissions(missingPermissions));
    }

    const connection = joinVoiceChannel({
      channelId: params.voiceChannel.id,
      guildId: params.guild.id,
      adapterCreator: params.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    const sessionId = `${Date.now()}-${process.pid}`;
    const segmentSpool = new SegmentSpool({ guildId: params.guild.id, sessionId });
    await segmentSpool.initialize();

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
      segmentRecords: [],
      transcriptionQueue: new TranscriptionQueue({ concurrency: transcriptionConcurrency }),
      segmentSpool,
      pendingSpools: new Set(),
      isStopping: false,
    };

    session.receiver.start();
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      if (session.isStopping) return;
      void session.segmentSpool.cleanup().finally(() => {
        this.sessions.delete(params.guild.id);
      });
    });

    this.sessions.set(params.guild.id, session);
    return toStatus(session);
  }

  async stop(guildId: string): Promise<StopTranscriptionResult> {
    return this.stopAndDump(guildId, { autoStopped: false });
  }

  async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (isDraining()) return;

    try {
      await trackOperation('voice:state-update', async () => {
        const session = this.sessions.get(oldState.guild.id);
        if (!session || session.isStopping) return;

        const touchedSessionChannel =
          oldState.channelId === session.voiceChannelId ||
          newState.channelId === session.voiceChannelId;
        if (!touchedSessionChannel) return;

        await new Promise((resolve) => setTimeout(resolve, 1_500));
        if (this.hasNonBotMembers(oldState.guild, session.voiceChannelId)) return;

        await this.stopAndDump(session.guildId, { autoStopped: true });
      });
    } catch (err) {
      if (isDrainInProgressError(err)) return;
      throw err;
    }
  }

  private async stopAndDump(
    guildId: string,
    { autoStopped, waitForFinal = false }: { autoStopped: boolean; waitForFinal?: boolean },
  ): Promise<StopTranscriptionResult> {
    const session = this.sessions.get(guildId);
    if (!session) {
      getVoiceConnection(guildId)?.destroy();
      return {
        stopped: false,
        segmentCount: 0,
        participantCount: 0,
        autoStopped,
        pendingCount: 0,
        failedCount: 0,
        timeoutCount: 0,
        final: true,
      };
    }

    session.isStopping = true;
    session.connection.destroy();
    await Promise.allSettled([...session.pendingSpools]);
    const stats = session.transcriptionQueue.stats();

    if (stats.pending === 0) {
      try {
        await this.sendTranscriptDump(session, autoStopped, { kind: 'final', timedOut: false });
      } finally {
        await session.segmentSpool.cleanup();
        this.sessions.delete(guildId);
      }

      return {
        stopped: true,
        segmentCount: session.transcript.length,
        participantCount: session.participants.size,
        autoStopped,
        pendingCount: 0,
        failedCount: stats.failed,
        timeoutCount: stats.timeout,
        final: true,
      };
    }

    await this.sendTranscriptDump(session, autoStopped, { kind: 'partial', timedOut: false });
    if (waitForFinal) {
      await this.finishStoppedSession(session, autoStopped);
      const finalStats = session.transcriptionQueue.stats();
      return {
        stopped: true,
        segmentCount: session.transcript.length,
        participantCount: session.participants.size,
        autoStopped,
        pendingCount: finalStats.pending,
        failedCount: finalStats.failed,
        timeoutCount: finalStats.timeout,
        final: true,
      };
    }

    void this.finishStoppedSession(session, autoStopped);

    return {
      stopped: true,
      segmentCount: session.transcript.length,
      participantCount: session.participants.size,
      autoStopped,
      pendingCount: stats.pending,
      failedCount: stats.failed,
      timeoutCount: stats.timeout,
      final: false,
    };
  }

  status(guildId: string): VoiceSessionStatus | null {
    const session = this.sessions.get(guildId);
    return session ? toStatus(session) : null;
  }

  async stopAllForShutdown({
    timeoutMs = 15_000,
  }: {
    timeoutMs?: number;
  } = {}): Promise<VoiceShutdownSummary> {
    const guildIds = [...this.sessions.keys()];
    if (!guildIds.length) {
      return { stopped: 0, timedOut: false, remainingSessions: 0 };
    }

    const stopAll = Promise.allSettled(
      guildIds.map((guildId) =>
        this.stopAndDump(guildId, { autoStopped: true, waitForFinal: true }),
      ),
    );
    const timedOut = await promiseTimedOut(stopAll, timeoutMs);

    if (timedOut) {
      for (const [guildId, session] of this.sessions) {
        session.connection.destroy();
        await session.segmentSpool.cleanup();
        this.sessions.delete(guildId);
      }
    }

    return {
      stopped: guildIds.length - this.sessions.size,
      timedOut,
      remainingSessions: this.sessions.size,
    };
  }

  private queueTranscription(session: VoiceSession, userId: string, segment: SpeechSegment): void {
    if (session.isStopping) return;

    const spoolTask = this.spoolAndQueueTranscription(session, userId, segment)
      .catch((err) => {
        console.error(
          `[voice] failed to spool segment guild=${session.guildId} user=${userId}`,
          err,
        );
      })
      .finally(() => {
        session.pendingSpools.delete(spoolTask);
      });
    session.pendingSpools.add(spoolTask);
  }

  private async finishStoppedSession(session: VoiceSession, autoStopped: boolean): Promise<void> {
    const progressMessage = await this.createProgressMessage(session);
    const progress = this.startProgressReporter(session, progressMessage);
    const timedOut = await promiseTimedOut(
      session.transcriptionQueue.onIdle(),
      transcriptionDrainTimeoutMs,
    );
    if (timedOut) {
      session.transcriptionQueue.markUnfinishedTimedOut(
        `Drain timed out after ${transcriptionDrainTimeoutMs}ms`,
      );
    }

    clearInterval(progress);
    try {
      await this.sendTranscriptDump(session, autoStopped, { kind: 'final', timedOut });
      await progressMessage.complete(session.transcriptionQueue.stats(), { timedOut });
    } catch (err) {
      console.error(`[voice] failed to send final transcript guild=${session.guildId}`, err);
    } finally {
      await session.segmentSpool.cleanup();
      this.sessions.delete(session.guildId);
    }
  }

  private async createProgressMessage(
    session: VoiceSession,
  ): Promise<TranscriptionProgressMessage> {
    const channel = await session.client.channels.fetch(session.textChannelId).catch(() => null);
    if (!isTextOutputChannel(channel)) return createNoopTranscriptionProgressMessage();

    return createTranscriptionProgressMessage(channel, session.transcriptionQueue.stats()).catch(
      (err) => {
        console.error(`[voice] failed to create progress message guild=${session.guildId}`, err);
        return createNoopTranscriptionProgressMessage();
      },
    );
  }

  private startProgressReporter(
    session: VoiceSession,
    progressMessage: TranscriptionProgressMessage,
  ): NodeJS.Timeout {
    return setInterval(() => {
      void progressMessage.update(session.transcriptionQueue.stats()).catch((err) => {
        console.error(`[voice] failed to update progress message guild=${session.guildId}`, err);
      });
    }, 30_000);
  }

  private async spoolAndQueueTranscription(
    session: VoiceSession,
    userId: string,
    segment: SpeechSegment,
  ): Promise<void> {
    const speaker = await this.getSpeakerIdentity(session, userId);
    if (speaker.isBot) return;

    const segmentId = session.transcriptionQueue.reserveId();
    const diskPath = await session.segmentSpool.writeSegment({
      segmentId,
      userId,
      timestamp: segment.startedAt,
      wav: encodePcm16MonoWav(segment.pcm),
    });

    const queued = session.transcriptionQueue.enqueue({
      id: segmentId,
      userId,
      timestamp: segment.startedAt,
      durationMs: segment.durationMs,
      diskPath,
      transcribe: () =>
        this.transcribeSegment(session, userId, speaker.displayName, segment.startedAt, diskPath),
    });
    session.segmentRecords.push(queued.record);

    void queued.completion.then((record) => {
      if (record.status !== 'failed') return;
      console.error(
        `[voice] transcription failed guild=${session.guildId} user=${userId} segment=${record.id}: ${record.lastError}`,
      );
    });
  }

  private reportRecoverableSpools(): void {
    if (this.checkedRecoverableSpools) return;
    this.checkedRecoverableSpools = true;

    void SegmentSpool.findRecoverableSessions()
      .then((sessions) => {
        if (!sessions.length) return;
        console.warn(
          `[voice] found ${sessions.length} recoverable transcription spool session(s); leaving files in place for manual re-processing or cleanup: ${sessions.join(', ')}`,
        );
      })
      .catch((err) => {
        console.warn('[voice] unable to inspect transcription spool directory', err);
      });
  }

  private async transcribeSegment(
    session: VoiceSession,
    userId: string,
    displayName: string,
    startedAt: Date,
    diskPath: string,
  ): Promise<string | null> {
    const wav = await session.segmentSpool.readSegment(diskPath);
    const result = await this.transcriptionClient.transcribeWav(
      wav,
      `${session.guildId}-${userId}-${startedAt.getTime()}.wav`,
    );
    if (!result.text) return null;

    session.participants.add(userId);
    session.participantCount = session.participants.size;
    session.segmentsTranscribed += 1;
    session.transcript.push({
      userId,
      displayName,
      timestamp: startedAt,
      text: result.text,
    });
    return result.text;
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

  private async sendTranscriptDump(
    session: VoiceSession,
    autoStopped: boolean,
    { kind, timedOut }: { kind: TranscriptDumpKind; timedOut: boolean },
  ): Promise<void> {
    const channel = await session.client.channels.fetch(session.textChannelId).catch(() => null);
    if (!isTextOutputChannel(channel)) return;

    const endedAt = new Date();
    const stats = session.transcriptionQueue.stats();
    const transcript = formatTranscript(
      {
        guildId: session.guildId,
        voiceChannelId: session.voiceChannelId,
        textChannelId: session.textChannelId,
        startedAt: session.startedAt,
        participants: session.participants.size,
        transcript: session.transcript,
        segmentRecords: session.segmentRecords,
      },
      { endedAt, kind, timedOut },
    );
    const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf8'), {
      name: `${kind}-transcript-${session.guildId}-${session.startedAt.toISOString().replace(/[:.]/g, '-')}.txt`,
    });

    await channel.send({
      content: [
        transcriptMessage(kind, autoStopped, timedOut),
        `Duration: ${formatDuration(endedAt.getTime() - session.startedAt.getTime())}`,
        `Participants: ${session.participants.size}`,
        `Segments included: ${session.transcript.length}`,
        `Queue: ${formatQueueSummary(stats)}`,
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

function transcriptMessage(
  kind: TranscriptDumpKind,
  autoStopped: boolean,
  timedOut: boolean,
): string {
  if (kind === 'partial') {
    return autoStopped
      ? 'Transcription stopped because the voice channel emptied. Partial transcript attached; remaining audio is still processing.'
      : 'Transcription stopped. Partial transcript attached; remaining audio is still processing.';
  }

  if (timedOut) {
    return 'Final transcription drain timed out. Latest partial transcript attached.';
  }

  return autoStopped
    ? 'Transcription stopped because the voice channel emptied. Final transcript attached.'
    : 'Transcription stopped. Final transcript attached.';
}

async function promiseTimedOut(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timeout = setTimeout(() => resolve('timeout'), Math.max(0, timeoutMs));
  });

  const result = await Promise.race([promise.then(() => 'done' as const), timeoutPromise]);
  if (timeout) clearTimeout(timeout);
  return result === 'timeout';
}
