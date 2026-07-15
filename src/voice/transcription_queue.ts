export type TranscriptionSegmentStatus = 'queued' | 'transcribing' | 'done' | 'failed';

export type TranscriptionSegmentRecord = {
  id: number;
  userId: string;
  timestamp: Date;
  durationMs: number;
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
  active: number;
  pending: number;
};

type QueueTask = {
  userId: string;
  timestamp: Date;
  durationMs: number;
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

  enqueue(task: QueueTask): QueuedTranscription {
    const record: TranscriptionSegmentRecord = {
      id: this.nextId,
      userId: task.userId,
      timestamp: task.timestamp,
      durationMs: task.durationMs,
      status: 'queued',
      result: null,
      attempts: 0,
      lastError: null,
    };
    this.nextId += 1;
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
      { queued: 0, transcribing: 0, done: 0, failed: 0 },
    );

    return {
      ...counts,
      active: this.activeCount,
      pending: this.queue.length + this.activeCount,
    };
  }

  async onIdle(): Promise<void> {
    if (this.isIdle()) return;

    await new Promise<void>((resolve) => {
      this.idleResolvers.add(resolve);
    });
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
    task.record.status = 'transcribing';
    task.record.attempts += 1;

    try {
      task.record.result = await task.transcribe();
      task.record.status = 'done';
      task.record.lastError = null;
    } catch (err) {
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
