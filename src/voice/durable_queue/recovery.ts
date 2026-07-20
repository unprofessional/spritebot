import { access, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { SegmentSpool } from '../segment_spool';
import { TranscriptionCheckpointController } from '../transcription_checkpoint_controller';
import { TranscriptionScheduler } from '../transcription_scheduler';
import { recoverFileManifestQueue, type FileManifestQueue } from './file_manifest_queue';
import type { ClaimedJob, FileManifestQueueOptions, ManifestHeader } from './types';

export type RecoveredTranscriptionSession = {
  queue: FileManifestQueue;
  scheduler: TranscriptionScheduler;
  checkpointController: TranscriptionCheckpointController;
  interrupted: boolean;
  completion: Promise<void>;
};

type RecoveryOptions = {
  activeLeaseHolder: boolean;
  baseDir: string;
  queueOptions: FileManifestQueueOptions;
  concurrency: number;
  retentionHours: number;
  maxConcurrentSessionsPerGuild?: number;
  checkpointIntervalSegments: number;
  checkpointIntervalMs: number;
  isDraining: () => boolean;
  transcribe: (header: Readonly<ManifestHeader>, job: ClaimedJob, wav: Buffer) => Promise<string>;
  onRecovered: (queue: FileManifestQueue, interrupted: boolean) => Promise<void>;
  onCompleted: (queue: FileManifestQueue, interrupted: boolean) => Promise<void>;
  now?: () => Date;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
};

export async function recoverTranscriptionSessions(
  options: RecoveryOptions,
): Promise<RecoveredTranscriptionSession[]> {
  if (!options.activeLeaseHolder) return [];
  const logger = options.logger ?? console;
  const now = options.now ?? (() => new Date());
  const sessionDirs = await manifestSessionDirectories(options.baseDir);
  const recovered: RecoveredTranscriptionSession[] = [];
  const recoveredByGuild = new Map<string, number>();
  const maxConcurrentSessionsPerGuild = options.maxConcurrentSessionsPerGuild ?? 2;

  for (const sessionDir of sessionDirs) {
    try {
      const queue = await recoverFileManifestQueue(sessionDir, options.queueOptions);
      if (queue.wasFullyResolvedOnRecovery) {
        if (isPastRetention(queue.stats().resolvedAt, options.retentionHours, now())) {
          await rm(sessionDir, { recursive: true, force: true });
          logger.log(`[voice] removed expired transcription spool ${sessionDir}`);
        }
        continue;
      }

      if (isOlderThan(queue.header.startedAt, options.retentionHours, now())) {
        logger.warn(`[voice] unresolved transcription spool is past retention: ${sessionDir}`);
      }

      const guildRecoveryCount = recoveredByGuild.get(queue.header.guildId) ?? 0;
      if (guildRecoveryCount >= maxConcurrentSessionsPerGuild) {
        logger.warn(
          `[voice] deferred transcription recovery because guild concurrency cap was reached guild=${queue.header.guildId} session=${queue.header.sessionId} cap=${maxConcurrentSessionsPerGuild}`,
        );
        continue;
      }
      recoveredByGuild.set(queue.header.guildId, guildRecoveryCount + 1);

      const interrupted = queue.recoveredCaptureInterrupted;
      await options.onRecovered(queue, interrupted).catch((err) => {
        logger.error(`[voice] recovered transcription notification failed ${sessionDir}`, err);
      });
      const checkpointController = new TranscriptionCheckpointController({
        queue,
        intervalSegments: options.checkpointIntervalSegments,
        intervalMs: options.checkpointIntervalMs,
        onError: (err) => logger.error(`[voice] recovered checkpoint failed ${sessionDir}`, err),
      });
      const spool = new SegmentSpool({ sessionDir });
      const scheduler = new TranscriptionScheduler({
        queue,
        spool,
        concurrency: options.concurrency,
        isDraining: options.isDraining,
        onTerminalJob: () => checkpointController.recordTerminalJob(),
        transcribe: (job, wav) => options.transcribe(queue.header, job, wav),
      });
      const completion = finishRecoveredSession(
        queue,
        scheduler,
        checkpointController,
        interrupted,
        options.onCompleted,
        logger,
      );
      const handle = { queue, scheduler, checkpointController, interrupted, completion };
      recovered.push(handle);
      scheduler.signal();
    } catch (err) {
      logger.error(`[voice] unable to recover transcription spool ${sessionDir}`, err);
    }
  }

  return recovered;
}

async function finishRecoveredSession(
  queue: FileManifestQueue,
  scheduler: TranscriptionScheduler,
  checkpointController: TranscriptionCheckpointController,
  interrupted: boolean,
  onCompleted: RecoveryOptions['onCompleted'],
  logger: Pick<Console, 'error'>,
): Promise<void> {
  try {
    await scheduler.onIdle();
    await checkpointController.stop();
    await onCompleted(queue, interrupted);
  } catch (err) {
    logger.error(`[voice] recovered transcription completion failed ${queue.sessionDir}`, err);
  }
}

async function manifestSessionDirectories(baseDir: string): Promise<string[]> {
  const entries = await readdir(baseDir, { withFileTypes: true }).catch((err: unknown) => {
    if (isNodeError(err) && err.code === 'ENOENT') return [];
    throw err;
  });
  const directories: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionDir = path.join(baseDir, entry.name);
    const hasManifest = await access(path.join(sessionDir, 'manifest.jsonl')).then(
      () => true,
      () => false,
    );
    if (hasManifest) directories.push(sessionDir);
  }
  return directories.sort();
}

function isPastRetention(resolvedAt: string | null, retentionHours: number, now: Date): boolean {
  return Boolean(
    resolvedAt &&
      now.getTime() - Date.parse(resolvedAt) >= Math.max(0, retentionHours) * 60 * 60 * 1_000,
  );
}

function isOlderThan(startedAt: string, retentionHours: number, now: Date): boolean {
  return now.getTime() - Date.parse(startedAt) >= Math.max(0, retentionHours) * 60 * 60 * 1_000;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
