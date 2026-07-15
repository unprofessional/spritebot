import { formatTranscript } from '../../../src/voice/transcript_formatter';
import type { TranscriptionSegmentRecord } from '../../../src/voice/transcription_queue';

describe('transcript_formatter', () => {
  test('formats partial transcripts with omitted segment details', () => {
    const transcript = formatTranscript(
      {
        guildId: 'guild-1',
        voiceChannelId: 'voice-1',
        textChannelId: 'text-1',
        startedAt: new Date('2026-07-15T00:00:00.000Z'),
        participants: 1,
        transcript: [
          {
            userId: 'user-1',
            displayName: 'Mads',
            timestamp: new Date('2026-07-15T00:00:02.000Z'),
            text: 'hello table',
          },
        ],
        segmentRecords: [
          segmentRecord(1, 'done', new Date('2026-07-15T00:00:02.000Z')),
          segmentRecord(2, 'failed', new Date('2026-07-15T00:00:04.000Z'), 'whisper failed'),
          segmentRecord(3, 'timeout', new Date('2026-07-15T00:00:06.000Z'), 'drain timed out'),
          segmentRecord(4, 'queued', new Date('2026-07-15T00:00:08.000Z')),
        ],
      },
      { endedAt: new Date('2026-07-15T00:01:00.000Z'), kind: 'partial', timedOut: true },
    );

    expect(transcript).toContain('SPRITEbot Voice Transcript (Partial)');
    expect(transcript).toContain('Segments included: 1');
    expect(transcript).toContain('Segments failed: 1');
    expect(transcript).toContain('Segments timed out: 1');
    expect(transcript).toContain('Segments still processing: 1');
    expect(transcript).toContain('[00:00:02] Mads: hello table');
    expect(transcript).toContain('- #2 failed 00:00:04 user=user-1 (whisper failed)');
    expect(transcript).toContain('- #3 timeout 00:00:06 user=user-1 (drain timed out)');
    expect(transcript).toContain('- #4 queued 00:00:08 user=user-1');
  });
});

function segmentRecord(
  id: number,
  status: TranscriptionSegmentRecord['status'],
  timestamp: Date,
  lastError: string | null = null,
): TranscriptionSegmentRecord {
  return {
    id,
    userId: 'user-1',
    timestamp,
    durationMs: 1_000,
    diskPath: `/tmp/${id}.wav`,
    status,
    result: status === 'done' ? 'hello table' : null,
    attempts: status === 'queued' ? 0 : 1,
    lastError,
  };
}
