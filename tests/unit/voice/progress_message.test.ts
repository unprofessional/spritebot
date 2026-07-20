import {
  buildTranscriptionProgressMessage,
  formatQueueSummary,
  formatTranscriptionProgress,
} from '../../../src/voice/progress_message';
import type { QueueStats } from '../../../src/voice/durable_queue/types';

describe('progress_message', () => {
  afterEach(() => jest.useRealTimers());

  test('formats durable queue progress and failures', () => {
    const stats = queueStats({
      committed: 12,
      processing: 2,
      done: 16,
      dead_letter: 1,
      dropped: 1,
    });
    expect(formatTranscriptionProgress(stats, { phase: 'processing' })).toBe(
      [
        'Transcription processing...',
        '██████░░░░░░ 50% (16/32 transcribed)',
        '12 queued · 2 in progress · 16 transcribed · 0 awaiting retry · 1 dead letter · 1 capture dropped',
      ].join('\n'),
    );
  });

  test('formats a concise queue summary', () => {
    expect(
      formatQueueSummary(queueStats({ committed: 3, processing: 1, done: 8, failed: 2 })),
    ).toBe(
      '3 queued · 1 in progress · 8 transcribed · 2 awaiting retry · 0 dead letter · 0 capture dropped',
    );
  });

  test('throttles rapid edits and forces completion', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T00:00:00.000Z'));
    const message = { edit: jest.fn().mockResolvedValue(undefined) };
    const progress = buildTranscriptionProgressMessage(
      message,
      formatTranscriptionProgress(queueStats({ committed: 2 }), { phase: 'processing' }),
      { minEditIntervalMs: 5_000 },
    );
    await progress.update(queueStats({ committed: 1, processing: 1 }));
    expect(message.edit).not.toHaveBeenCalled();
    await progress.complete(queueStats({ done: 2 }));
    expect(message.edit).toHaveBeenCalledTimes(1);
    expect(message.edit.mock.calls[0][0].content).toContain('Transcription complete.');
  });

  test('renders zero-work and all-failed outcomes without treating failures as success', () => {
    expect(formatTranscriptionProgress(queueStats({}), { phase: 'processing' })).toContain(
      '100% (0/0 transcribed)',
    );
    expect(
      formatTranscriptionProgress(queueStats({ dead_letter: 3 }), { phase: 'complete' }),
    ).toContain('0% (0/3 transcribed)');
  });
});

function queueStats(overrides: Partial<QueueStats>): QueueStats {
  const base = {
    committed: 0,
    processing: 0,
    done: 0,
    failed: 0,
    dead_letter: 0,
    dropped: 0,
  };
  const counts = { ...base, ...overrides };
  return {
    ...counts,
    total:
      overrides.total ??
      counts.committed + counts.processing + counts.done + counts.failed + counts.dead_letter,
    pending: overrides.pending ?? counts.committed + counts.processing + counts.failed,
    pendingDurationMs: overrides.pendingDurationMs ?? 0,
    sealed: overrides.sealed ?? false,
    resolvedAt: overrides.resolvedAt ?? null,
  };
}
