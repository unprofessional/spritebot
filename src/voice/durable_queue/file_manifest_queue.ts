import { chmod, lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import { readCheckpoint, writeCheckpoint } from './checkpoint';
import {
  applyManifestEvent,
  emptySnapshot,
  ManifestEvent,
  ManifestEventPayload,
  ManifestWal,
} from './manifest';
import type {
  ClaimedJob,
  DroppedCapture,
  FileManifestQueueOptions,
  JobState,
  ManifestHeader,
  QueueSnapshot,
  QueueStats,
  SegmentJob,
  TranscriptionJobQueue,
  TranscriptionResult,
} from './types';

const DEFAULT_RETRY_BASE_MS = 30_000;
const DEFAULT_RETRY_MAX_MS = 600_000;

export class FileManifestQueue implements TranscriptionJobQueue {
  readonly header: Readonly<ManifestHeader>;
  private readonly wal: ManifestWal;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly now: () => Date;
  private readonly jitter: () => number;
  private snapshot: QueueSnapshot;
  private mutationTail: Promise<void> = Promise.resolve();

  private constructor(
    readonly sessionDir: string,
    header: ManifestHeader,
    snapshot: QueueSnapshot,
    options: FileManifestQueueOptions,
    readonly recoveredCaptureInterrupted = false,
    readonly wasFullyResolvedOnRecovery = false,
  ) {
    this.header = Object.freeze({ ...header });
    this.snapshot = snapshot;
    this.wal = new ManifestWal(sessionDir);
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts));
    this.retryBaseMs = Math.max(1, Math.floor(options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS));
    this.retryMaxMs = Math.max(
      this.retryBaseMs,
      Math.floor(options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS),
    );
    this.now = options.now ?? (() => new Date());
    this.jitter = options.jitter ?? Math.random;
  }

  static async create(
    sessionDir: string,
    metadata: Omit<ManifestHeader, 'kind' | 'version'>,
    options: FileManifestQueueOptions,
  ): Promise<FileManifestQueue> {
    await mkdir(sessionDir, { recursive: true, mode: 0o700 });
    await chmod(sessionDir, 0o700);
    const header: ManifestHeader = { kind: 'header', version: 1, ...metadata };
    const queue = new FileManifestQueue(sessionDir, header, emptySnapshot(), options);
    await queue.wal.initialize(header);
    return queue;
  }

  async commit(segment: SegmentJob): Promise<void> {
    validateSegment(segment);
    await this.mutate(async () => {
      if (this.snapshot.sealed) throw new Error('Cannot commit to a sealed transcription queue.');
      if (this.snapshot.jobs.some((job) => job.id === segment.id)) {
        throw new Error(`Duplicate transcription job ${segment.id}`);
      }
      await this.append({ type: 'commit', job: segment });
    });
  }

  async claim(): Promise<ClaimedJob | null> {
    return this.mutate(async () => {
      const nowMs = this.now().getTime();
      const job = this.snapshot.jobs.find(
        (candidate) =>
          candidate.status === 'committed' ||
          (candidate.status === 'failed' &&
            candidate.attempts < this.maxAttempts &&
            (!candidate.nextEligibleAt || Date.parse(candidate.nextEligibleAt) <= nowMs)),
      );
      if (!job) return null;
      const attempts = job.attempts + 1;
      await this.append({ type: 'claim', jobId: job.id, attempts });
      return toClaimedJob(job, attempts);
    });
  }

  nextEligibleAt(): string | null {
    const retryTimes = this.snapshot.jobs
      .filter((job) => job.status === 'failed' && job.nextEligibleAt)
      .map((job) => job.nextEligibleAt as string)
      .sort();
    return retryTimes[0] ?? null;
  }

  async ack(jobId: string, result: string): Promise<void> {
    await this.mutate(async () => {
      requireProcessing(this.snapshot, jobId);
      await this.append({ type: 'ack', jobId, result });
      await this.resolveIfNeeded();
    });
  }

  async nack(jobId: string, error: string): Promise<void> {
    await this.mutate(async () => {
      const job = requireProcessing(this.snapshot, jobId);
      if (job.attempts >= this.maxAttempts) {
        await this.append({ type: 'dead_letter', jobId, error });
        await this.resolveIfNeeded();
        return;
      }
      await this.append({
        type: 'nack',
        jobId,
        error,
        nextEligibleAt: new Date(
          this.now().getTime() + this.retryDelay(job.attempts),
        ).toISOString(),
      });
    });
  }

  async deadLetter(jobId: string, error: string): Promise<void> {
    await this.mutate(async () => {
      const job = requireJob(this.snapshot, jobId);
      if (job.status === 'done' || job.status === 'dead_letter') {
        throw new Error(`Cannot dead letter terminal transcription job ${jobId}`);
      }
      await this.append({ type: 'dead_letter', jobId, error });
      await this.resolveIfNeeded();
    });
  }

  async seal(): Promise<void> {
    await this.mutate(async () => {
      if (!this.snapshot.sealed) await this.append({ type: 'seal' });
      await this.resolveIfNeeded();
    });
  }

  async addParticipant(userId: string, displayName: string): Promise<void> {
    await this.mutate(async () => {
      if (this.snapshot.participants.some((participant) => participant.userId === userId)) return;
      await this.append({ type: 'add_participant', userId, displayName });
    });
  }

  async recordDroppedCapture(capture: DroppedCapture): Promise<void> {
    await this.mutate(async () => {
      if (this.snapshot.sealed) throw new Error('Cannot record capture after queue seal.');
      await this.append({ type: 'capture_dropped', capture });
    });
  }

  isFullyResolved(): boolean {
    return isResolvedState(this.snapshot);
  }

  stats(): QueueStats {
    const stats: QueueStats = {
      committed: 0,
      processing: 0,
      done: 0,
      failed: 0,
      dead_letter: 0,
      total: this.snapshot.jobs.length,
      pending: 0,
      dropped: this.snapshot.droppedCaptures.length,
      sealed: this.snapshot.sealed,
      resolvedAt: this.snapshot.resolvedAt,
    };
    for (const job of this.snapshot.jobs) stats[job.status] += 1;
    stats.pending = stats.committed + stats.processing + stats.failed;
    return stats;
  }

  completedResults(): TranscriptionResult[] {
    return [
      ...this.snapshot.jobs
        .filter((job) => job.status === 'done' || job.status === 'dead_letter')
        .map<TranscriptionResult>((job) => ({
          jobId: job.id,
          userId: job.userId,
          displayName: job.displayName,
          timestamp: job.timestamp,
          text: job.status === 'done' ? job.result : null,
          status: job.status === 'done' ? 'done' : 'dead_letter',
          error: job.status === 'dead_letter' ? job.lastError : null,
        })),
      ...this.snapshot.droppedCaptures.map<TranscriptionResult>((capture) => ({
        jobId: capture.id,
        userId: capture.userId,
        displayName: capture.displayName,
        timestamp: capture.timestamp,
        text: null,
        status: 'capture_dropped',
        error: capture.reason,
      })),
    ].sort((left, right) =>
      left.timestamp === right.timestamp
        ? left.jobId.localeCompare(right.jobId)
        : left.timestamp.localeCompare(right.timestamp),
    );
  }

  async checkpoint(): Promise<void> {
    await this.mutate(() =>
      writeCheckpoint(this.sessionDir, {
        version: 1,
        throughEventSeq: this.snapshot.throughEventSeq,
        results: this.completedResults(),
      }),
    );
  }

  async compact(): Promise<void> {
    await this.mutate(() => this.wal.compact(this.header, cloneSnapshot(this.snapshot)));
  }

  private async append(payload: ManifestEventPayload): Promise<void> {
    const event: ManifestEvent = {
      ...payload,
      eventSeq: this.snapshot.throughEventSeq + 1,
      at: this.now().toISOString(),
    };
    await this.wal.append(event);
    applyManifestEvent(this.snapshot, event);
  }

  private async resolveIfNeeded(): Promise<void> {
    if (!isResolvedState(this.snapshot) || this.snapshot.resolvedAt) return;
    const triggeringEventSeq = this.snapshot.throughEventSeq;
    await this.append({
      type: 'resolved',
      resolvedAt: this.now().toISOString(),
      terminal: this.snapshot.jobs.length,
      triggeringEventSeq,
    });
  }

  private retryDelay(attempts: number): number {
    const base = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** Math.max(0, attempts - 1));
    const jitterMultiplier = 0.8 + Math.min(1, Math.max(0, this.jitter())) * 0.4;
    return Math.min(this.retryMaxMs, Math.round(base * jitterMultiplier));
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  static fromRecovered(
    sessionDir: string,
    header: ManifestHeader,
    snapshot: QueueSnapshot,
    options: FileManifestQueueOptions,
    recoveredCaptureInterrupted: boolean,
    wasFullyResolvedOnRecovery: boolean,
  ): FileManifestQueue {
    return new FileManifestQueue(
      sessionDir,
      header,
      snapshot,
      options,
      recoveredCaptureInterrupted,
      wasFullyResolvedOnRecovery,
    );
  }

  async repairRecoveredState(): Promise<void> {
    const processing = this.snapshot.jobs
      .filter((candidate) => candidate.status === 'processing')
      .map((job) => job.id);
    for (const jobId of processing) {
      await this.mutate(() =>
        this.append({
          type: 'recovery_reset',
          jobId,
          nextEligibleAt: new Date(0).toISOString(),
        }),
      );
    }
    if (!this.snapshot.sealed) {
      await this.mutate(() => this.append({ type: 'recovery_seal' }));
    }
    await this.mutate(() => this.resolveIfNeeded());
  }
}

export async function recoverFileManifestQueue(
  sessionDir: string,
  options: FileManifestQueueOptions,
): Promise<FileManifestQueue> {
  const replayed = await ManifestWal.recover(sessionDir);
  const snapshot = cloneSnapshot(replayed.snapshot);
  for (const event of replayed.events) applyManifestEvent(snapshot, event);
  const recoveredCaptureInterrupted = !snapshot.sealed;
  const wasFullyResolvedOnRecovery = isResolvedState(snapshot);
  const queue = FileManifestQueue.fromRecovered(
    sessionDir,
    replayed.header,
    snapshot,
    options,
    recoveredCaptureInterrupted,
    wasFullyResolvedOnRecovery,
  );

  await queue.repairRecoveredState();
  await validateRecoveredSpoolPaths(sessionDir, snapshot.jobs);
  await reportOrphanWavs(sessionDir, snapshot.jobs);
  await cleanupDoneWavs(sessionDir, snapshot.jobs);

  const checkpoint = await readCheckpoint(sessionDir);
  if (!checkpoint || checkpoint.throughEventSeq !== snapshot.throughEventSeq) {
    await queue.checkpoint();
  }
  return queue;
}

function validateSegment(segment: SegmentJob): void {
  if (!segment.id) throw new Error('Transcription job ID is required.');
  if (!segment.spoolPath || path.isAbsolute(segment.spoolPath)) {
    throw new Error('Transcription spool path must be relative.');
  }
  const normalized = path.normalize(segment.spoolPath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error('Transcription spool path escapes the session directory.');
  }
}

function requireJob(snapshot: QueueSnapshot, jobId: string): JobState {
  const job = snapshot.jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error(`Unknown transcription job ${jobId}`);
  return job;
}

function requireProcessing(snapshot: QueueSnapshot, jobId: string): JobState {
  const job = requireJob(snapshot, jobId);
  if (job.status !== 'processing') {
    throw new Error(`Transcription job ${jobId} is ${job.status}, not processing.`);
  }
  return job;
}

function isResolvedState(snapshot: QueueSnapshot): boolean {
  return (
    snapshot.sealed &&
    snapshot.jobs.every((job) => job.status === 'done' || job.status === 'dead_letter')
  );
}

function toClaimedJob(job: JobState, attempts: number): ClaimedJob {
  return {
    id: job.id,
    userId: job.userId,
    displayName: job.displayName,
    timestamp: job.timestamp,
    durationMs: job.durationMs,
    spoolPath: job.spoolPath,
    attempts,
  };
}

function cloneSnapshot(snapshot: QueueSnapshot): QueueSnapshot {
  return structuredClone(snapshot);
}

async function cleanupDoneWavs(sessionDir: string, jobs: JobState[]): Promise<void> {
  const donePaths = new Set(
    jobs.filter((job) => job.status === 'done').map((job) => job.spoolPath),
  );
  const entries = await readdir(sessionDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && donePaths.has(entry.name))
      .map((entry) => rm(path.join(sessionDir, entry.name), { force: true })),
  );
}

async function validateRecoveredSpoolPaths(sessionDir: string, jobs: JobState[]): Promise<void> {
  const sessionRealPath = await realpath(sessionDir);
  for (const job of jobs) {
    validateSegment(job);
    const candidate = path.join(sessionDir, job.spoolPath);
    const stats = await lstat(candidate).catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stats) continue;
    if (stats.isSymbolicLink()) throw new Error(`Spool path for job ${job.id} is a symbolic link.`);
    const candidateRealPath = await realpath(candidate);
    if (!isWithin(sessionRealPath, candidateRealPath)) {
      throw new Error(`Spool path for job ${job.id} escapes the session directory.`);
    }
  }
}

async function reportOrphanWavs(sessionDir: string, jobs: JobState[]): Promise<void> {
  const knownPaths = new Set(jobs.map((job) => job.spoolPath));
  const entries = await readdir(sessionDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.wav') && !knownPaths.has(entry.name)) {
      console.warn(`[voice] retaining orphan transcription WAV for inspection: ${entry.name}`);
    }
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}
