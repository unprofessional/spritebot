import {
  buildTranscriptionProgressMessage,
  formatQueueSummary,
  formatTranscriptionProgress,
} from '../../../src/voice/progress_message';
import type { TranscriptionQueueStats } from '../../../src/voice/transcription_queue';

describe('progress_message', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('formats readable progress with failed and timed-out segments resolved', () => {
    const stats = queueStats({
      queued: 12,
      transcribing: 2,
      done: 16,
      failed: 1,
      timeout: 1,
    });

    expect(formatTranscriptionProgress(stats, { phase: 'processing' })).toBe(
      [
        'Transcription still processing...',
        '███████░░░░░ 56% (18/32 segments)',
        '12 queued, 2 in progress, 16 complete, 1 failed, 1 timed out',
      ].join('\n'),
    );
  });

  test('formats zero-segment progress as complete', () => {
    expect(formatTranscriptionProgress(queueStats({}), { phase: 'complete' })).toBe(
      [
        'Transcription complete. Final transcript posted below.',
        '████████████ 100% (0/0 segments)',
        '0 queued, 0 in progress, 0 complete, 0 failed, 0 timed out',
      ].join('\n'),
    );
  });

  test('formats transcript queue summary without raw key value counters', () => {
    expect(
      formatQueueSummary(
        queueStats({
          queued: 3,
          transcribing: 1,
          done: 8,
          failed: 0,
          timeout: 2,
        }),
      ),
    ).toBe('3 queued, 1 in progress, 8 complete, 0 failed, 2 timed out');
  });

  test('progress handle throttles rapid edits and forces final updates', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T00:00:00.000Z'));
    const message = { edit: jest.fn().mockResolvedValue(undefined) };
    const initialContent = formatTranscriptionProgress(queueStats({ queued: 4 }), {
      phase: 'processing',
    });
    const progress = buildTranscriptionProgressMessage(message, initialContent, {
      minEditIntervalMs: 5_000,
    });

    await progress.update(queueStats({ queued: 3, transcribing: 1 }));
    expect(message.edit).not.toHaveBeenCalled();

    jest.advanceTimersByTime(5_000);
    await progress.update(queueStats({ queued: 2, transcribing: 1, done: 1 }));
    expect(message.edit).toHaveBeenCalledTimes(1);
    expect(message.edit).toHaveBeenLastCalledWith({
      content: [
        'Transcription still processing...',
        '███░░░░░░░░░ 25% (1/4 segments)',
        '2 queued, 1 in progress, 1 complete, 0 failed, 0 timed out',
      ].join('\n'),
    });

    await progress.complete(queueStats({ done: 2, failed: 1, timeout: 1 }), { timedOut: true });
    expect(message.edit).toHaveBeenCalledTimes(2);
    expect(message.edit).toHaveBeenLastCalledWith({
      content: [
        'Transcription drain timed out. Latest transcript posted below.',
        '████████████ 100% (4/4 segments)',
        '0 queued, 0 in progress, 2 complete, 1 failed, 1 timed out',
      ].join('\n'),
    });
  });
});

function queueStats(overrides: Partial<TranscriptionQueueStats>): TranscriptionQueueStats {
  return {
    queued: 0,
    transcribing: 0,
    done: 0,
    failed: 0,
    timeout: 0,
    active: 0,
    pending: (overrides.queued ?? 0) + (overrides.transcribing ?? 0),
    ...overrides,
  };
}
