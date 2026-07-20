import { open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import type { DroppedCapture, JobState, ManifestHeader, QueueSnapshot, SegmentJob } from './types';

export type ManifestEventPayload =
  | { type: 'commit'; job: SegmentJob }
  | { type: 'claim'; jobId: string; attempts: number }
  | { type: 'ack'; jobId: string; result: string }
  | { type: 'nack'; jobId: string; error: string; nextEligibleAt: string }
  | { type: 'dead_letter'; jobId: string; error: string }
  | { type: 'seal' }
  | { type: 'add_participant'; userId: string; displayName: string }
  | { type: 'capture_dropped'; capture: DroppedCapture }
  | { type: 'recovery_reset'; jobId: string; nextEligibleAt: string }
  | { type: 'recovery_seal' }
  | { type: 'resolved'; resolvedAt: string; terminal: number; triggeringEventSeq: number };

export type ManifestEvent = ManifestEventPayload & { eventSeq: number; at: string };

type SnapshotRecord = { kind: 'snapshot'; snapshot: QueueSnapshot };

export type ReplayedManifest = {
  header: ManifestHeader;
  snapshot: QueueSnapshot;
  events: ManifestEvent[];
};

export class ManifestWal {
  readonly manifestPath: string;
  readonly tempPath: string;
  private poisonedError: Error | null = null;

  constructor(readonly sessionDir: string) {
    this.manifestPath = path.join(sessionDir, 'manifest.jsonl');
    this.tempPath = path.join(sessionDir, 'manifest.compact.tmp');
  }

  async initialize(header: ManifestHeader): Promise<void> {
    const handle = await open(this.manifestPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(header)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(this.sessionDir);
  }

  async append(event: ManifestEvent): Promise<void> {
    if (this.poisonedError) throw this.poisonedError;
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(this.manifestPath, 'a', 0o600);
      await handle.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
      await handle.sync();
    } catch (error) {
      this.poisonedError = new Error('Manifest WAL write is uncertain; recovery is required.', {
        cause: error,
      });
      throw this.poisonedError;
    } finally {
      await handle?.close();
    }
  }

  async compact(header: ManifestHeader, snapshot: QueueSnapshot): Promise<void> {
    if (this.poisonedError) throw this.poisonedError;
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(this.tempPath, 'wx', 0o600);
      await handle.writeFile(
        `${JSON.stringify(header)}\n${JSON.stringify({ kind: 'snapshot', snapshot })}\n`,
        'utf8',
      );
      await handle.sync();
    } catch (error) {
      this.poisonedError = new Error(
        'Manifest compaction write is uncertain; recovery is required.',
        {
          cause: error,
        },
      );
      throw this.poisonedError;
    } finally {
      await handle?.close();
    }
    try {
      await rename(this.tempPath, this.manifestPath);
      await syncDirectory(this.sessionDir);
    } catch (error) {
      this.poisonedError = new Error(
        'Manifest compaction replacement is uncertain; recovery is required.',
        { cause: error },
      );
      throw this.poisonedError;
    }
  }

  static async recover(sessionDir: string): Promise<ReplayedManifest> {
    const wal = new ManifestWal(sessionDir);
    await rm(wal.tempPath, { force: true });
    const raw = await readFile(wal.manifestPath, 'utf8');
    const { valid, truncated } = validJsonLines(raw);
    if (truncated) await truncateTo(wal.manifestPath, valid);
    const records = valid
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ManifestHeader | SnapshotRecord | ManifestEvent);
    const header = records[0];
    if (!isHeader(header)) throw new Error(`Invalid manifest header in ${wal.manifestPath}`);

    let snapshot = emptySnapshot();
    let eventStart = 1;
    const possibleSnapshot = records[1];
    if (isSnapshot(possibleSnapshot)) {
      snapshot = possibleSnapshot.snapshot;
      eventStart = 2;
    }
    const events = records.slice(eventStart) as ManifestEvent[];
    validateEventSequence(events, snapshot.throughEventSeq);
    return { header, snapshot, events };
  }
}

export function applyManifestEvent(snapshot: QueueSnapshot, event: ManifestEvent): void {
  snapshot.throughEventSeq = event.eventSeq;
  switch (event.type) {
    case 'commit':
      snapshot.jobs.push({
        ...event.job,
        status: 'committed',
        attempts: 0,
        result: null,
        lastError: null,
        nextEligibleAt: null,
      });
      break;
    case 'claim': {
      const job = requireJob(snapshot.jobs, event.jobId);
      job.status = 'processing';
      job.attempts = event.attempts;
      job.nextEligibleAt = null;
      break;
    }
    case 'ack': {
      const job = requireJob(snapshot.jobs, event.jobId);
      job.status = 'done';
      job.result = event.result;
      job.lastError = null;
      job.nextEligibleAt = null;
      break;
    }
    case 'nack': {
      const job = requireJob(snapshot.jobs, event.jobId);
      job.status = 'failed';
      job.lastError = event.error;
      job.nextEligibleAt = event.nextEligibleAt;
      break;
    }
    case 'dead_letter': {
      const job = requireJob(snapshot.jobs, event.jobId);
      job.status = 'dead_letter';
      job.lastError = event.error;
      job.nextEligibleAt = null;
      break;
    }
    case 'seal':
    case 'recovery_seal':
      snapshot.sealed = true;
      break;
    case 'add_participant':
      if (!snapshot.participants.some((participant) => participant.userId === event.userId)) {
        snapshot.participants.push({ userId: event.userId, displayName: event.displayName });
      }
      break;
    case 'capture_dropped':
      snapshot.droppedCaptures.push(event.capture);
      break;
    case 'recovery_reset': {
      const job = requireJob(snapshot.jobs, event.jobId);
      job.status = 'failed';
      job.nextEligibleAt = event.nextEligibleAt;
      break;
    }
    case 'resolved':
      if (!snapshot.resolvedAt || event.resolvedAt < snapshot.resolvedAt) {
        snapshot.resolvedAt = event.resolvedAt;
      }
      break;
  }
}

export function emptySnapshot(): QueueSnapshot {
  return {
    throughEventSeq: 0,
    sealed: false,
    resolvedAt: null,
    participants: [],
    jobs: [],
    droppedCaptures: [],
  };
}

async function truncateTo(filePath: string, contents: string): Promise<void> {
  const handle = await open(filePath, 'r+');
  try {
    await handle.truncate(Buffer.byteLength(contents));
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function validJsonLines(raw: string): { valid: string; truncated: boolean } {
  const lines = raw.split('\n');
  if (lines.at(-1) !== '') lines.pop();
  const valid: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      JSON.parse(line);
      valid.push(line);
    } catch {
      break;
    }
  }
  const contents = valid.length ? `${valid.join('\n')}\n` : '';
  return { valid: contents, truncated: contents !== raw };
}

function validateEventSequence(events: ManifestEvent[], after: number): void {
  let expected = after + 1;
  for (const event of events) {
    if (event.eventSeq !== expected) {
      throw new Error(`Manifest event sequence ${event.eventSeq} did not match ${expected}`);
    }
    expected += 1;
  }
}

function requireJob(jobs: JobState[], jobId: string): JobState {
  const job = jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error(`Unknown transcription job ${jobId}`);
  return job;
}

function isHeader(record: unknown): record is ManifestHeader {
  return Boolean(
    record &&
      typeof record === 'object' &&
      'kind' in record &&
      record.kind === 'header' &&
      'version' in record &&
      record.version === 1,
  );
}

function isSnapshot(record: unknown): record is SnapshotRecord {
  return Boolean(
    record && typeof record === 'object' && 'kind' in record && record.kind === 'snapshot',
  );
}

export async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
