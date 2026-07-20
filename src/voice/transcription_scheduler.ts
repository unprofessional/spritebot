import type { ClaimedJob, TranscriptionJobQueue } from './durable_queue/types';
import { SegmentSpool } from './segment_spool';

type TranscribeJob = (
  job: {
    id: string;
    userId: string;
    displayName: string;
    timestamp: string;
    durationMs: number;
    spoolPath: string;
    attempts: number;
  },
  wav: Buffer,
) => Promise<string>;

type SchedulerOptions = {
  queue: TranscriptionJobQueue;
  spool: SegmentSpool;
  concurrency: number;
  transcribe: TranscribeJob;
  isDraining?: () => boolean;
  now?: () => number;
};

export class TranscriptionScheduler {
  private readonly queue: TranscriptionJobQueue;
  private readonly spool: SegmentSpool;
  private readonly concurrency: number;
  private readonly transcribe: TranscribeJob;
  private readonly isDraining: () => boolean;
  private readonly now: () => number;
  private active = 0;
  private pumping = false;
  private wakeTimer: NodeJS.Timeout | null = null;
  private idleWaiters: Array<() => void> = [];

  constructor(options: SchedulerOptions) {
    this.queue = options.queue;
    this.spool = options.spool;
    this.concurrency = Math.max(1, Math.floor(options.concurrency));
    this.transcribe = options.transcribe;
    this.isDraining = options.isDraining ?? (() => false);
    this.now = options.now ?? Date.now;
  }

  signal(): void {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    void this.pump();
  }

  onIdle(): Promise<void> {
    if (this.queue.stats().pending === 0 && this.active === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.isDraining()) return;
    this.pumping = true;
    try {
      while (this.active < this.concurrency && !this.isDraining()) {
        const job = await this.queue.claim();
        if (!job) break;
        this.active += 1;
        void this.run(job).finally(() => {
          this.active -= 1;
          this.signal();
          this.resolveIdleWaiters();
        });
      }
      this.armRetryWake();
      this.resolveIdleWaiters();
    } finally {
      this.pumping = false;
    }
  }

  private async run(job: ClaimedJob): Promise<void> {
    let result: string;
    try {
      const wav = await this.spool.readSegment(job.spoolPath);
      result = await this.transcribe(job, wav);
    } catch (err) {
      await this.queue.nack(job.id, errorMessage(err));
      return;
    }
    await this.queue.ack(job.id, result);
    await this.spool.deleteSegment(job.spoolPath).catch((err) => {
      console.warn(`[voice] unable to delete completed segment ${job.id}`, err);
    });
  }

  private armRetryWake(): void {
    if (this.wakeTimer || this.isDraining()) return;
    const eligibleAt = this.queue.nextEligibleAt();
    if (!eligibleAt) return;
    const delay = Math.max(0, Date.parse(eligibleAt) - this.now());
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      this.signal();
    }, delay);
  }

  private resolveIdleWaiters(): void {
    if (this.active !== 0 || this.queue.stats().pending !== 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
