import type { QueueStats } from '../../../src/voice/durable_queue/types';
import { transcriptMessage } from '../../../src/voice/voice_manager';

describe('transcription final status messages', () => {
  test('distinguishes complete, background, and permanently failed outcomes', () => {
    expect(transcriptMessage('final', false, stats({ done: 3, total: 3 }))).toContain(
      '✅ Transcription complete — 3/3 segments.',
    );
    expect(
      transcriptMessage('partial', false, stats({ done: 2, committed: 1, pending: 1, total: 3 })),
    ).toContain('⏳ 2/3 transcribed. Background processing continues');
    expect(
      transcriptMessage('final', false, stats({ done: 2, dead_letter: 1, total: 3 })),
    ).toContain('⚠️ 2/3 segments transcribed. 1 permanently failed.');
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
