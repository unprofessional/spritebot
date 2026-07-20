import type { QueueStats } from '../../../src/voice/durable_queue/types';
import {
  BacklogWarningPolicy,
  TranscriptionQueueHealthMonitor,
} from '../../../src/voice/transcription_queue_health';

describe('TranscriptionQueueHealthMonitor', () => {
  test('uses pending audio duration and observed audio throughput for drain estimates', () => {
    let now = 0;
    const monitor = new TranscriptionQueueHealthMonitor(100, 25, () => now);
    monitor.recordCommit(60_000);
    monitor.recordCommit(600_000);
    now = 60_000;
    monitor.recordCompletion(60_000);

    const shortBacklog = monitor.measure(stats({ committed: 2, pendingDurationMs: 120_000 }));
    const longBacklog = monitor.measure(stats({ committed: 2, pendingDurationMs: 600_000 }));

    expect(shortBacklog.enqueueRatePerMinute).toBe(2);
    expect(shortBacklog.completionRatePerMinute).toBe(1);
    expect(shortBacklog.estimatedDrainMinutes).toBe(2);
    expect(longBacklog.estimatedDrainMinutes).toBe(10);
  });

  test('uses high and low watermarks as pressure hysteresis', () => {
    const monitor = new TranscriptionQueueHealthMonitor(10, 3);
    expect(monitor.measure(stats({ committed: 10 })).pressure).toBe('elevated');
    expect(monitor.measure(stats({ committed: 5 })).pressure).toBe('elevated');
    expect(monitor.measure(stats({ committed: 3 })).pressure).toBe('normal');
    expect(monitor.measure(stats({ committed: 20 })).pressure).toBe('critical');
  });
});

describe('BacklogWarningPolicy', () => {
  test('warns above threshold, observes cooldown, and repeats only after doubling', () => {
    let now = 0;
    const policy = new BacklogWarningPolicy(10, () => now);
    expect(policy.shouldWarn(9)).toBe(false);
    expect(policy.shouldWarn(11)).toBe(true);
    now += 16 * 60_000;
    expect(policy.shouldWarn(15)).toBe(false);
    expect(policy.shouldWarn(22)).toBe(true);
  });

  test('does not repeat within the cooldown even when the estimate doubles', () => {
    let now = 0;
    const policy = new BacklogWarningPolicy(10, () => now);
    expect(policy.shouldWarn(10)).toBe(true);
    now += 14 * 60_000;
    expect(policy.shouldWarn(30)).toBe(false);
  });
});

function stats(overrides: Partial<QueueStats>): QueueStats {
  return {
    committed: 0,
    processing: 0,
    done: 0,
    failed: 0,
    dead_letter: 0,
    total: 0,
    pending: 0,
    pendingDurationMs: 0,
    dropped: 0,
    sealed: false,
    resolvedAt: null,
    ...overrides,
  };
}
