export type TranscriptionSegmentStatus = 'queued' | 'transcribing' | 'done' | 'failed' | 'timeout';

export type TranscriptionSegmentRecord = {
  id: number;
  userId: string;
  timestamp: Date;
  durationMs: number;
  diskPath: string | null;
  status: TranscriptionSegmentStatus;
  result: string | null;
  attempts: number;
  lastError: string | null;
};

export type TranscriptionQueueStats = {
  queued: number;
  transcribing: number;
  done: number;
  failed: number;
  timeout: number;
  active: number;
  pending: number;
};

type QueueTask = {
  id?: number;
  userId: string;
  timestamp: Date;
  durationMs: number;
  diskPath?: string | null;
  transcribe: () => Promise<string | null>;
};

type QueuedTask = {
  record: TranscriptionSegmentRecord;
  transcribe: () => Promise<string | null>;
  resolve: (record: TranscriptionSegmentRecord) => void;
};

export type QueuedTranscription = {
  record: TranscriptionSegmentRecord;
  completion: Promise<TranscriptionSegmentRecord>;
};

export class TranscriptionQueue {
  private readonly concurrency: number;
  private readonly queue: QueuedTask[] = [];
  private readonly records: TranscriptionSegmentRecord[] = [];
  private readonly idleResolvers = new Set<() => void>();
  private activeCount = 0;
  private nextId = 1;

  constructor({ concurrency }: { concurrency: number }) {
    this.concurrency = Math.max(1, Math.floor(concurrency));
  }

  reserveId(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  enqueue(task: QueueTask): QueuedTranscription {
    const id = task.id ?? this.reserveId();
    const record: TranscriptionSegmentRecord = {
      id,
      userId: task.userId,
      timestamp: task.timestamp,
      durationMs: task.durationMs,
      diskPath: task.diskPath ?? null,
      status: 'queued',
      result: null,
      attempts: 0,
      lastError: null,
    };
    this.records.push(record);

    const completion = new Promise<TranscriptionSegmentRecord>((resolve) => {
      this.queue.push({ record, transcribe: task.transcribe, resolve });
      this.pump();
    });

    return { record, completion };
  }

  snapshot(): TranscriptionSegmentRecord[] {
    return [...this.records];
  }

  stats(): TranscriptionQueueStats {
    const counts = this.records.reduce(
      (acc, record) => {
        acc[record.status] += 1;
        return acc;
      },
      { queued: 0, transcribing: 0, done: 0, failed: 0, timeout: 0 },
    );

    return {
      ...counts,
      active: this.activeCount,
      pending: counts.queued + counts.transcribing,
    };
  }

  async onIdle(): Promise<void> {
    if (this.isIdle()) return;

    await new Promise<void>((resolve) => {
      this.idleResolvers.add(resolve);
    });
  }

  markUnfinishedTimedOut(message: string): number {
    const queuedTasks = this.queue.splice(0);
    let timedOut = 0;

    for (const task of queuedTasks) {
      if (task.record.status !== 'queued' && task.record.status !== 'transcribing') continue;
      task.record.status = 'timeout';
      task.record.lastError = message;
      timedOut += 1;
      task.resolve(task.record);
    }

    for (const record of this.records) {
      if (record.status !== 'queued' && record.status !== 'transcribing') continue;
      record.status = 'timeout';
      record.lastError = message;
      timedOut += 1;
    }

    this.resolveIdleIfReady();
    return timedOut;
  }

  private pump(): void {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) continue;

      this.activeCount += 1;
      void this.runTask(task);
    }

    this.resolveIdleIfReady();
  }

  private async runTask(task: QueuedTask): Promise<void> {
    const isTimedOut = () => task.record.status === ('timeout' as TranscriptionSegmentStatus);

    if (isTimedOut()) {
      task.resolve(task.record);
      return;
    }

    task.record.status = 'transcribing';
    task.record.attempts += 1;

    try {
      const result = await task.transcribe();
      if (isTimedOut()) return;
      task.record.result = result;
      task.record.status = 'done';
      task.record.lastError = null;
    } catch (err) {
      if (isTimedOut()) return;
      task.record.status = 'failed';
      task.record.lastError = errorMessage(err);
    } finally {
      task.resolve(task.record);
      this.activeCount -= 1;
      this.pump();
    }
  }

  private isIdle(): boolean {
    return this.activeCount === 0 && this.queue.length === 0;
  }

  private resolveIdleIfReady(): void {
    if (!this.isIdle()) return;

    for (const resolve of this.idleResolvers) {
      resolve();
    }
    this.idleResolvers.clear();
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
