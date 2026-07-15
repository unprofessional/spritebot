import type { TranscriptionSegmentRecord } from './transcription_queue';

export type TranscriptEntry = {
  userId: string;
  displayName: string;
  timestamp: Date;
  text: string;
};

export type TranscriptSessionSummary = {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  startedAt: Date;
  participants: number;
  transcript: TranscriptEntry[];
  segmentRecords: TranscriptionSegmentRecord[];
};

export type TranscriptDumpKind = 'partial' | 'final';

export function formatTranscript(
  session: TranscriptSessionSummary,
  { endedAt, kind, timedOut }: { endedAt: Date; kind: TranscriptDumpKind; timedOut: boolean },
): string {
  const sorted = [...session.transcript].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
  const failed = session.segmentRecords.filter((record) => record.status === 'failed');
  const timeout = session.segmentRecords.filter((record) => record.status === 'timeout');
  const pending = session.segmentRecords.filter(
    (record) => record.status === 'queued' || record.status === 'transcribing',
  );

  const lines = [
    kind === 'partial' ? 'SPRITEbot Voice Transcript (Partial)' : 'SPRITEbot Voice Transcript',
    `Voice channel: ${session.voiceChannelId}`,
    `Text channel: ${session.textChannelId}`,
    `Started: ${session.startedAt.toISOString()}`,
    `Ended: ${endedAt.toISOString()}`,
    `Duration: ${formatDuration(endedAt.getTime() - session.startedAt.getTime())}`,
    `Participants: ${session.participants}`,
    `Segments included: ${sorted.length}`,
    `Segments failed: ${failed.length}`,
    `Segments timed out: ${timeout.length}`,
    `Segments still processing: ${pending.length}`,
  ];

  if (timedOut) {
    lines.push('Drain timed out before every segment finished.');
  }

  lines.push('');

  if (sorted.length === 0) {
    lines.push('(No speech segments were transcribed.)');
  } else {
    for (const entry of sorted) {
      lines.push(
        `[${formatOffset(entry.timestamp.getTime() - session.startedAt.getTime())}] ${entry.displayName}: ${entry.text}`,
      );
    }
  }

  const omitted = [...failed, ...timeout, ...pending].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
  if (omitted.length > 0) {
    lines.push('', 'Omitted segments:');
    for (const record of omitted) {
      lines.push(
        `- #${record.id} ${record.status} ${formatOffset(record.timestamp.getTime() - session.startedAt.getTime())} user=${record.userId}${record.lastError ? ` (${record.lastError})` : ''}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

export function formatDuration(ms: number): string {
  return formatOffset(ms);
}

function formatOffset(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}
