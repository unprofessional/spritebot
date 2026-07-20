import { randomUUID } from 'node:crypto';

import { VoiceConnection, VoiceConnectionStatus } from '@discordjs/voice';
import {
  AttachmentBuilder,
  ChannelType,
  Channel,
  Client,
  Events,
  Guild,
  GuildMember,
  GuildTextBasedChannel,
  VoiceState,
  VoiceBasedChannel,
  User,
} from 'discord.js';

import {
  DrainInProgressError,
  isDrainInProgressError,
  isDraining,
  trackOperation,
} from '../runtime/lifecycle';
import {
  transcriptionCheckpointIntervalMs,
  transcriptionCheckpointIntervalSegments,
  transcriptionConcurrency,
  transcriptionCriticalDiskMb,
  transcriptionJobMaxAttempts,
  transcriptionJobRetryBaseMs,
  transcriptionJobRetryMaxMs,
  transcriptionLowDiskMb,
  transcriptionSpoolDir,
  transcriptionSpoolRetentionHours,
} from '../config/env_config';
import { defineDiscordOperationPolicy } from '../discord/operation_policy';
import { executeDiscordSdkMethod, executeDiscordSdkMethodAs } from '../discord/sdk_operations';
import {
  destroyExistingDiscordVoiceConnection,
  joinDiscordVoiceChannel,
  waitForDiscordVoiceState,
} from '../discord/voice_operations';
import { AudioReceiver } from './audio_receiver';
import { checkDiskSpace, evaluateDiskPressure } from './durable_queue/disk_util';
import { FileManifestQueue } from './durable_queue/file_manifest_queue';
import {
  recoverTranscriptionSessions,
  type RecoveredTranscriptionSession,
} from './durable_queue/recovery';
import type {
  ClaimedJob,
  ManifestHeader,
  QueueStats,
  TranscriptionJobQueue,
} from './durable_queue/types';
import {
  createNoopTranscriptionProgressMessage,
  createTranscriptionProgressMessage,
  formatQueueSummary,
  type TranscriptionProgressMessage,
} from './progress_message';
import { SegmentSpool } from './segment_spool';
import type { SpeechSegment } from './segment_buffer';
import { formatDuration, formatTranscript, type TranscriptDumpKind } from './transcript_formatter';
import { TranscriptionClient } from './transcription_client';
import { TranscriptionCheckpointController } from './transcription_checkpoint_controller';
import { TranscriptionScheduler } from './transcription_scheduler';
import {
  formatMissingTranscriptionPermissions,
  getMissingTranscriptionPermissions,
} from './transcription_permissions';
import { encodePcm16MonoWav } from './wav';

const voiceJoinPolicy = defineDiscordOperationPolicy({
  operation: 'voice.join',
  timeoutMs: 5_000,
  totalBudgetMs: 5_000,
});
const voiceReadyPolicy = defineDiscordOperationPolicy({
  operation: 'voice.wait-ready',
  timeoutMs: 21_000,
  totalBudgetMs: 21_000,
});
const voiceDestroyPolicy = defineDiscordOperationPolicy({
  operation: 'voice.destroy-connection',
  timeoutMs: 2_000,
  totalBudgetMs: 2_000,
});
const voiceChannelReadPolicy = defineDiscordOperationPolicy({
  operation: 'voice.fetch-output-channel',
  timeoutMs: 2_000,
  totalBudgetMs: 5_000,
  retry: 'safe-read',
  maxAttempts: 2,
});
const voiceMemberReadPolicy = defineDiscordOperationPolicy({
  operation: 'voice.fetch-speaker-member',
  timeoutMs: 2_000,
  totalBudgetMs: 5_000,
  retry: 'safe-read',
  maxAttempts: 2,
});
const voiceUserReadPolicy = defineDiscordOperationPolicy({
  operation: 'voice.fetch-speaker-user',
  timeoutMs: 2_000,
  totalBudgetMs: 5_000,
  retry: 'safe-read',
  maxAttempts: 2,
});
const voiceSendPolicy = defineDiscordOperationPolicy({
  operation: 'voice.send-transcript',
  timeoutMs: 5_000,
  totalBudgetMs: 5_000,
});

export type StartTranscriptionParams = {
  client: Client;
  guild: Guild;
  voiceChannel: VoiceBasedChannel;
  textChannel: GuildTextBasedChannel;
  startedBy: string;
};

export type VoiceSessionStatus = {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  startedAt: Date;
  segmentsTranscribed: number;
  participantCount: number;
  droppedCaptureCount: number;
  processingPreviousSession: boolean;
};

export type StopTranscriptionResult = {
  stopped: boolean;
  segmentCount: number;
  participantCount: number;
  autoStopped: boolean;
  pendingCount: number;
  failedCount: number;
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
  participants: Set<string>;
  speakerIdentities: Map<string, SpeakerIdentity>;
  jobQueue: TranscriptionJobQueue;
  scheduler: TranscriptionScheduler;
  checkpointController: TranscriptionCheckpointController;
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
  private readonly recoveredSessions = new Set<RecoveredTranscriptionSession>();
  private readonly transcriptionClient = new TranscriptionClient();
  private installedClient: Client | null = null;
  private recoveryStarted = false;

  install(client: Client): void {
    if (this.installedClient) return;
    this.installedClient = client;
    client.once(Events.ClientReady, () => {
      void this.recoverPreviousSessions(client);
    });
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

    const connection = await joinDiscordVoiceChannel(voiceJoinPolicy, {
      channelId: params.voiceChannel.id,
      guildId: params.guild.id,
      adapterCreator: params.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    await waitForDiscordVoiceState(
      voiceReadyPolicy,
      connection,
      VoiceConnectionStatus.Ready,
      20_000,
    );

    const sessionId = `${Date.now()}-${process.pid}`;
    const segmentSpool = new SegmentSpool({ guildId: params.guild.id, sessionId });
    await segmentSpool.initialize();
    const startedAt = new Date();
    const jobQueue = await FileManifestQueue.create(
      segmentSpool.sessionDir,
      {
        sessionId,
        guildId: params.guild.id,
        voiceChannelId: params.voiceChannel.id,
        textChannelId: params.textChannel.id,
        startedAt: startedAt.toISOString(),
        startedBy: params.startedBy,
      },
      {
        maxAttempts: transcriptionJobMaxAttempts,
        retryBaseMs: transcriptionJobRetryBaseMs,
        retryMaxMs: transcriptionJobRetryMaxMs,
      },
    );
    const checkpointController = new TranscriptionCheckpointController({
      queue: jobQueue,
      intervalSegments: transcriptionCheckpointIntervalSegments,
      intervalMs: transcriptionCheckpointIntervalMs,
      onError: (err) =>
        console.error(`[voice] failed to checkpoint transcription guild=${params.guild.id}`, err),
    });

    let session: VoiceSession;
    session = {
      client: params.client,
      guildId: params.guild.id,
      voiceChannelId: params.voiceChannel.id,
      textChannelId: params.textChannel.id,
      startedAt,
      segmentsTranscribed: 0,
      participantCount: 0,
      droppedCaptureCount: 0,
      processingPreviousSession: false,
      connection,
      receiver: new AudioReceiver(connection, (userId, segment) =>
        this.queueTranscription(session, userId, segment),
      ),
      participants: new Set(),
      speakerIdentities: new Map(),
      jobQueue,
      scheduler: new TranscriptionScheduler({
        queue: jobQueue,
        spool: segmentSpool,
        concurrency: transcriptionConcurrency,
        isDraining,
        onTerminalJob: () => checkpointController.recordTerminalJob(),
        transcribe: (job, wav) => this.transcribeSegment(session, job, wav),
      }),
      checkpointController,
      segmentSpool,
      pendingSpools: new Set(),
      isStopping: false,
    };

    session.receiver.start();
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      if (session.isStopping) return;
      void session.checkpointController.stop().finally(() => {
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
    { autoStopped }: { autoStopped: boolean },
  ): Promise<StopTranscriptionResult> {
    const session = this.sessions.get(guildId);
    if (!session) {
      await destroyExistingDiscordVoiceConnection(voiceDestroyPolicy, guildId);
      return {
        stopped: false,
        segmentCount: 0,
        participantCount: 0,
        autoStopped,
        pendingCount: 0,
        failedCount: 0,
        final: true,
      };
    }

    session.isStopping = true;
    await executeDiscordSdkMethod(voiceDestroyPolicy, session.connection, 'destroy');
    await Promise.allSettled([...session.pendingSpools]);
    await session.jobQueue.seal();
    await session.checkpointController.flush();
    const stats = session.jobQueue.stats();

    if (stats.pending === 0) {
      try {
        await session.checkpointController.stop();
        await this.sendTranscriptDump(session, autoStopped, { kind: 'final' });
      } finally {
        this.sessions.delete(guildId);
      }

      return {
        stopped: true,
        segmentCount: stats.done,
        participantCount: session.participants.size,
        autoStopped,
        pendingCount: 0,
        failedCount: stats.dead_letter,
        final: true,
      };
    }

    session.processingPreviousSession = true;
    await this.sendTranscriptDump(session, autoStopped, { kind: 'partial' });
    void this.finishStoppedSession(session, autoStopped);

    return {
      stopped: true,
      segmentCount: stats.done,
      participantCount: session.participants.size,
      autoStopped,
      pendingCount: stats.pending,
      failedCount: stats.dead_letter,
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
    const recoveredSessions = [...this.recoveredSessions];
    if (!guildIds.length && !recoveredSessions.length) {
      return { stopped: 0, timedOut: false, remainingSessions: 0 };
    }

    const stopAll = Promise.allSettled([
      ...guildIds.map((guildId) => this.stopSessionForShutdown(this.sessions.get(guildId))),
      ...recoveredSessions.map((session) => this.stopRecoveredSessionForShutdown(session)),
    ]);
    const timedOut = await promiseTimedOut(stopAll, timeoutMs);

    if (timedOut) {
      for (const [guildId, session] of this.sessions) {
        await executeDiscordSdkMethod(voiceDestroyPolicy, session.connection, 'destroy').catch(
          () => undefined,
        );
        await session.checkpointController.stop();
        this.sessions.delete(guildId);
      }
      for (const session of this.recoveredSessions) {
        await session.checkpointController.stop();
        this.recoveredSessions.delete(session);
      }
    }

    return {
      stopped:
        guildIds.length +
        recoveredSessions.length -
        this.sessions.size -
        this.recoveredSessions.size,
      timedOut,
      remainingSessions: this.sessions.size + this.recoveredSessions.size,
    };
  }

  private async stopSessionForShutdown(session: VoiceSession | undefined): Promise<void> {
    if (!session) return;
    session.isStopping = true;
    await executeDiscordSdkMethod(voiceDestroyPolicy, session.connection, 'destroy').catch(
      () => undefined,
    );
    await Promise.allSettled([...session.pendingSpools]);
    await session.jobQueue.seal();
    await session.scheduler.onQuiescent();
    await session.checkpointController.stop();
    this.sessions.delete(session.guildId);
  }

  private async stopRecoveredSessionForShutdown(
    session: RecoveredTranscriptionSession,
  ): Promise<void> {
    await session.scheduler.onQuiescent();
    await session.checkpointController.stop();
    this.recoveredSessions.delete(session);
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
    await session.scheduler.onIdle();

    clearInterval(progress);
    try {
      await session.checkpointController.stop();
      await this.sendTranscriptDump(session, autoStopped, { kind: 'final' });
      await progressMessage.complete(session.jobQueue.stats());
    } catch (err) {
      console.error(`[voice] failed to send final transcript guild=${session.guildId}`, err);
    } finally {
      this.sessions.delete(session.guildId);
    }
  }

  private async createProgressMessage(
    session: VoiceSession,
  ): Promise<TranscriptionProgressMessage> {
    const channel = await executeDiscordSdkMethodAs<Channel | null>(
      voiceChannelReadPolicy,
      session.client.channels,
      'fetch',
      session.textChannelId,
    ).catch(() => null);
    if (!isTextOutputChannel(channel)) return createNoopTranscriptionProgressMessage();

    return createTranscriptionProgressMessage(channel, session.jobQueue.stats()).catch((err) => {
      console.error(`[voice] failed to create progress message guild=${session.guildId}`, err);
      return createNoopTranscriptionProgressMessage();
    });
  }

  private startProgressReporter(
    session: VoiceSession,
    progressMessage: TranscriptionProgressMessage,
  ): NodeJS.Timeout {
    return setInterval(() => {
      void progressMessage.update(session.jobQueue.stats()).catch((err) => {
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

    const segmentId = randomUUID();
    const timestamp = segment.startedAt.toISOString();
    const pressure = evaluateDiskPressure(
      await checkDiskSpace(session.segmentSpool.sessionDir),
      transcriptionLowDiskMb,
      transcriptionCriticalDiskMb,
    );
    if (pressure === 'low') {
      console.warn(`[voice] transcription spool disk space is low guild=${session.guildId}`);
    }
    if (pressure === 'critical') {
      await session.jobQueue.recordDroppedCapture({
        id: segmentId,
        userId,
        displayName: speaker.displayName,
        timestamp,
        durationMs: segment.durationMs,
        reason: 'Capture refused because transcription spool disk space is critical.',
      });
      return;
    }

    const spoolPath = await session.segmentSpool.writeSegment({
      segmentId,
      wav: encodePcm16MonoWav(segment.pcm),
    });
    const pressureAfterWrite = evaluateDiskPressure(
      await checkDiskSpace(session.segmentSpool.sessionDir),
      transcriptionLowDiskMb,
      transcriptionCriticalDiskMb,
    );
    if (pressureAfterWrite !== 'normal') {
      console.warn(
        `[voice] transcription spool disk pressure=${pressureAfterWrite} after segment write guild=${session.guildId}`,
      );
    }
    await session.jobQueue.commit({
      id: segmentId,
      userId,
      displayName: speaker.displayName,
      timestamp,
      durationMs: segment.durationMs,
      spoolPath,
    });
    session.scheduler.signal();
  }

  private async recoverPreviousSessions(client: Client): Promise<void> {
    if (this.recoveryStarted) return;
    this.recoveryStarted = true;
    const recovered = await recoverTranscriptionSessions({
      activeLeaseHolder: true,
      baseDir: transcriptionSpoolDir,
      queueOptions: {
        maxAttempts: transcriptionJobMaxAttempts,
        retryBaseMs: transcriptionJobRetryBaseMs,
        retryMaxMs: transcriptionJobRetryMaxMs,
      },
      concurrency: transcriptionConcurrency,
      retentionHours: transcriptionSpoolRetentionHours,
      checkpointIntervalSegments: transcriptionCheckpointIntervalSegments,
      checkpointIntervalMs: transcriptionCheckpointIntervalMs,
      isDraining,
      transcribe: (header, job, wav) => this.transcribeRecoveredSegment(header, job, wav),
      onRecovered: (queue, interrupted) => this.sendRecoveryNotice(client, queue, interrupted),
      onCompleted: (queue, interrupted) => this.sendRecoveredTranscript(client, queue, interrupted),
    });
    for (const session of recovered) {
      this.recoveredSessions.add(session);
      void session.completion.finally(() => this.recoveredSessions.delete(session));
    }
  }

  private async transcribeRecoveredSegment(
    header: Readonly<ManifestHeader>,
    job: ClaimedJob,
    wav: Buffer,
  ): Promise<string> {
    const result = await this.transcriptionClient.transcribeWav(
      wav,
      `${header.guildId}-${job.userId}-${Date.parse(job.timestamp)}.wav`,
    );
    return result.text;
  }

  private async sendRecoveryNotice(
    client: Client,
    queue: FileManifestQueue,
    interrupted: boolean,
  ): Promise<void> {
    const channel = await this.fetchOutputChannel(client, queue.header.textChannelId);
    if (!channel) return;
    const suffix = interrupted
      ? ' Capture ended unexpectedly; only audio committed before SPRITEbot stopped can be recovered.'
      : '';
    await executeDiscordSdkMethod(voiceSendPolicy, channel, 'send', {
      content: `🔄 Recovered ${queue.stats().pending} unfinished segments from a previous session. Processing now — an updated transcript will be posted when complete.${suffix}`,
    });
  }

  private async sendRecoveredTranscript(
    client: Client,
    queue: FileManifestQueue,
    interrupted: boolean,
  ): Promise<void> {
    const channel = await this.fetchOutputChannel(client, queue.header.textChannelId);
    if (!channel) return;
    const stats = queue.stats();
    const endedAt = new Date();
    const startedAt = new Date(queue.header.startedAt);
    const results = queue.completedResults();
    const participants = new Set(results.map((result) => result.userId)).size;
    const transcript = formatTranscript(
      {
        guildId: queue.header.guildId,
        voiceChannelId: queue.header.voiceChannelId,
        textChannelId: queue.header.textChannelId,
        startedAt,
        participants,
        results,
        stats,
      },
      { endedAt, kind: 'final' },
    );
    const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf8'), {
      name: `recovered-transcript-${queue.header.guildId}-${queue.header.startedAt.replace(/[:.]/g, '-')}.txt`,
    });
    await executeDiscordSdkMethod(voiceSendPolicy, channel, 'send', {
      content: `${transcriptMessage('final', false, stats)}${interrupted ? ' This session ended unexpectedly before recovery.' : ''}`,
      files: [attachment],
    });
  }

  private async fetchOutputChannel(
    client: Client,
    channelId: string,
  ): Promise<GuildTextBasedChannel | null> {
    const channel = await executeDiscordSdkMethodAs<Channel | null>(
      voiceChannelReadPolicy,
      client.channels,
      'fetch',
      channelId,
    ).catch(() => null);
    return isTextOutputChannel(channel) ? channel : null;
  }

  private async transcribeSegment(
    session: VoiceSession,
    job: { userId: string; displayName: string; timestamp: string },
    wav: Buffer,
  ): Promise<string> {
    const result = await this.transcriptionClient.transcribeWav(
      wav,
      `${session.guildId}-${job.userId}-${Date.parse(job.timestamp)}.wav`,
    );
    if (!result.text) return '';

    session.participants.add(job.userId);
    session.participantCount = session.participants.size;
    session.segmentsTranscribed += 1;
    await session.jobQueue.addParticipant(job.userId, job.displayName);
    return result.text;
  }

  private async getSpeakerIdentity(
    session: VoiceSession,
    userId: string,
  ): Promise<SpeakerIdentity> {
    const cached = session.speakerIdentities.get(userId);
    if (cached) return cached;

    const guild = session.client.guilds.cache.get(session.guildId);
    const member = guild
      ? await executeDiscordSdkMethodAs<GuildMember>(
          voiceMemberReadPolicy,
          guild.members,
          'fetch',
          userId,
        ).catch(() => null)
      : null;
    const user =
      member?.user ??
      (await executeDiscordSdkMethodAs<User>(
        voiceUserReadPolicy,
        session.client.users,
        'fetch',
        userId,
      ).catch(() => null));
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
    { kind }: { kind: TranscriptDumpKind },
  ): Promise<void> {
    const channel = await executeDiscordSdkMethodAs<Channel | null>(
      voiceChannelReadPolicy,
      session.client.channels,
      'fetch',
      session.textChannelId,
    ).catch(() => null);
    if (!isTextOutputChannel(channel)) return;

    const endedAt = new Date();
    const stats = session.jobQueue.stats();
    const transcript = formatTranscript(
      {
        guildId: session.guildId,
        voiceChannelId: session.voiceChannelId,
        textChannelId: session.textChannelId,
        startedAt: session.startedAt,
        participants: session.participants.size,
        results: session.jobQueue.completedResults(),
        stats,
      },
      { endedAt, kind },
    );
    const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf8'), {
      name: `${kind}-transcript-${session.guildId}-${session.startedAt.toISOString().replace(/[:.]/g, '-')}.txt`,
    });

    await executeDiscordSdkMethod(voiceSendPolicy, channel, 'send', {
      content: [
        transcriptMessage(kind, autoStopped, stats),
        `Duration: ${formatDuration(endedAt.getTime() - session.startedAt.getTime())}`,
        `Participants: ${session.participants.size}`,
        `Segments included: ${stats.done}`,
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
    droppedCaptureCount: session.jobQueue.stats().dropped,
    processingPreviousSession: session.processingPreviousSession,
  };
}

export const voiceManager = new VoiceManager();

export function initializeVoiceTranscription(client: Client): void {
  voiceManager.install(client);
}

function transcriptMessage(
  kind: TranscriptDumpKind,
  autoStopped: boolean,
  stats: QueueStats,
): string {
  if (kind === 'partial') {
    return autoStopped
      ? 'Transcription stopped because the voice channel emptied. Partial transcript attached; remaining audio is still processing.'
      : 'Transcription stopped. Partial transcript attached; remaining audio is still processing.';
  }

  if (stats.dead_letter > 0) {
    return `⚠️ Transcription finished — ${stats.done}/${stats.total} segments transcribed, ${stats.dead_letter} permanently failed. Final transcript attached.`;
  }
  return `✅ Transcription complete — ${stats.done}/${stats.total} segments. Final transcript attached.`;
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
