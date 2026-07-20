import type { TranscriptionJobQueue } from './durable_queue/types';

type CheckpointControllerOptions = {
  queue: TranscriptionJobQueue;
  intervalSegments: number;
  intervalMs: number;
  onError?: (err: unknown) => void;
};

export class TranscriptionCheckpointController {
  private readonly queue: TranscriptionJobQueue;
  private readonly intervalSegments: number;
  private readonly onError: (err: unknown) => void;
  private completedSinceCheckpoint = 0;
  private checkpointTail: Promise<void> = Promise.resolve();
  private readonly timer: NodeJS.Timeout;

  constructor(options: CheckpointControllerOptions) {
    this.queue = options.queue;
    this.intervalSegments = Math.max(1, Math.floor(options.intervalSegments));
    this.onError = options.onError ?? (() => undefined);
    this.timer = setInterval(() => this.requestCheckpoint(), Math.max(1, options.intervalMs));
    this.timer.unref();
  }

  recordTerminalJob(): void {
    this.completedSinceCheckpoint += 1;
    if (this.completedSinceCheckpoint >= this.intervalSegments) this.requestCheckpoint();
  }

  async flush(): Promise<void> {
    this.requestCheckpoint();
    await this.checkpointTail;
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }

  private requestCheckpoint(): void {
    this.completedSinceCheckpoint = 0;
    this.checkpointTail = this.checkpointTail
      .then(() => this.queue.checkpoint())
      .catch((err) => this.onError(err));
  }
}
