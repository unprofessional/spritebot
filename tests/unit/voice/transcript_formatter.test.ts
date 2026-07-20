import { formatTranscript } from '../../../src/voice/transcript_formatter';
import type { QueueStats } from '../../../src/voice/durable_queue/types';

describe('transcript_formatter', () => {
  test('formats completed, dead-lettered, and dropped durable results', () => {
    const transcript = formatTranscript(
      {
        guildId: 'guild-1',
        voiceChannelId: 'voice-1',
        textChannelId: 'text-1',
        startedAt: new Date('2026-07-15T00:00:00.000Z'),
        participants: 1,
        results: [
          result('one', 'done', '2026-07-15T00:00:02.000Z', 'hello table'),
          result('two', 'dead_letter', '2026-07-15T00:00:04.000Z', null, 'failed'),
          result('three', 'capture_dropped', '2026-07-15T00:00:06.000Z', null, 'disk'),
        ],
        stats: stats({ done: 1, dead_letter: 1, dropped: 1 }),
      },
      { endedAt: new Date('2026-07-15T00:01:00.000Z'), kind: 'partial' },
    );
    expect(transcript).toContain('Segments included: 1');
    expect(transcript).toContain('Segments dead-lettered: 1');
    expect(transcript).toContain('Captures dropped: 1');
    expect(transcript).toContain('[00:00:02] Mads: hello table');
    expect(transcript).toContain('#two dead_letter 00:00:04 user=user-1 (failed)');
    expect(transcript).toContain('#three capture_dropped 00:00:06 user=user-1 (disk)');
  });
});

function result(
  jobId: string,
  status: 'done' | 'dead_letter' | 'capture_dropped',
  timestamp: string,
  text: string | null,
  error: string | null = null,
) {
  return { jobId, userId: 'user-1', displayName: 'Mads', timestamp, text, status, error };
}

function stats(overrides: Partial<QueueStats>): QueueStats {
  const counts = { committed: 0, processing: 0, done: 0, failed: 0, dead_letter: 0, ...overrides };
  return {
    ...counts,
    total: counts.committed + counts.processing + counts.done + counts.failed + counts.dead_letter,
    pending: counts.committed + counts.processing + counts.failed,
    dropped: overrides.dropped ?? 0,
    sealed: false,
    resolvedAt: null,
  };
}
