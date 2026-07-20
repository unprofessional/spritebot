import type { QueueStats } from './durable_queue/types';

export type TranscriptionPressure = 'normal' | 'elevated' | 'critical';

export type TranscriptionQueueHealth = {
  enqueueRatePerMinute: number;
  completionRatePerMinute: number;
  queueDepth: number;
  estimatedDrainMinutes: number | null;
  pressure: TranscriptionPressure;
};

export class BacklogWarningPolicy {
  private lastWarningAt: number | null = null;
  private lastEstimate: number | null = null;

  constructor(
    private readonly thresholdMinutes: number,
    private readonly now: () => number = Date.now,
    private readonly cooldownMs = 15 * 60_000,
  ) {}

  shouldWarn(estimatedDrainMinutes: number | null): boolean {
    if (estimatedDrainMinutes === null || estimatedDrainMinutes < this.thresholdMinutes) {
      return false;
    }
    const measuredAt = this.now();
    const cooldownElapsed =
      this.lastWarningAt === null || measuredAt - this.lastWarningAt >= this.cooldownMs;
    const worsenedSignificantly =
      this.lastEstimate === null || estimatedDrainMinutes >= this.lastEstimate * 2;
    if (!cooldownElapsed || !worsenedSignificantly) return false;
    this.lastWarningAt = measuredAt;
    this.lastEstimate = estimatedDrainMinutes;
    return true;
  }
}

type TimedSample = { at: number; durationMs: number };

export class TranscriptionQueueHealthMonitor {
  private readonly commits: TimedSample[] = [];
  private readonly completions: TimedSample[] = [];
  private pressure: TranscriptionPressure = 'normal';
  private readonly startedAt: number;

  constructor(
    private readonly highWater: number,
    private readonly lowWater: number,
    private readonly now: () => number = Date.now,
    private readonly windowMs = 5 * 60_000,
  ) {
    this.startedAt = this.now();
  }

  recordCommit(durationMs: number): void {
    this.commits.push({ at: this.now(), durationMs });
  }

  recordCompletion(durationMs: number): void {
    this.completions.push({ at: this.now(), durationMs });
  }

  measure(stats: QueueStats): TranscriptionQueueHealth {
    const measuredAt = this.now();
    this.prune(this.commits, measuredAt);
    this.prune(this.completions, measuredAt);
    const queueDepth = stats.committed + stats.failed;
    this.pressure = nextPressure(this.pressure, queueDepth, this.lowWater, this.highWater);
    const completionAudioMs = this.completions.reduce(
      (total, sample) => total + sample.durationMs,
      0,
    );
    const observedMs = this.observationMs(measuredAt);
    const audioMsPerWallMs = observedMs > 0 ? completionAudioMs / observedMs : 0;

    return {
      enqueueRatePerMinute: this.ratePerMinute(this.commits, measuredAt),
      completionRatePerMinute: this.ratePerMinute(this.completions, measuredAt),
      queueDepth,
      estimatedDrainMinutes:
        audioMsPerWallMs > 0 ? stats.pendingDurationMs / audioMsPerWallMs / 60_000 : null,
      pressure: this.pressure,
    };
  }

  private prune(samples: TimedSample[], measuredAt: number): void {
    const cutoff = measuredAt - this.windowMs;
    while (samples[0]?.at < cutoff) samples.shift();
  }

  private observationMs(measuredAt: number): number {
    return Math.max(1, Math.min(this.windowMs, measuredAt - this.startedAt));
  }

  private ratePerMinute(samples: TimedSample[], measuredAt: number): number {
    return (samples.length * 60_000) / this.observationMs(measuredAt);
  }
}

function nextPressure(
  current: TranscriptionPressure,
  depth: number,
  lowWater: number,
  highWater: number,
): TranscriptionPressure {
  if (depth >= highWater * 2) return 'critical';
  if (depth >= highWater) return 'elevated';
  if (depth <= lowWater) return 'normal';
  return current;
}
