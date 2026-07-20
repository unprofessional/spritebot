import type { QueueStats, TranscriptionResult } from './durable_queue/types';

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
  results: TranscriptionResult[];
  stats: QueueStats;
};

export type TranscriptDumpKind = 'partial' | 'final';

export function formatTranscript(
  session: TranscriptSessionSummary,
  { endedAt, kind }: { endedAt: Date; kind: TranscriptDumpKind },
): string {
  const sorted = session.results.filter((result) => result.status === 'done' && result.text);
  const omitted = session.results.filter((result) => result.status !== 'done');

  const lines = [
    kind === 'partial' ? 'SPRITEbot Voice Transcript (Partial)' : 'SPRITEbot Voice Transcript',
    `Voice channel: ${session.voiceChannelId}`,
    `Text channel: ${session.textChannelId}`,
    `Started: ${session.startedAt.toISOString()}`,
    `Ended: ${endedAt.toISOString()}`,
    `Duration: ${formatDuration(endedAt.getTime() - session.startedAt.getTime())}`,
    `Participants: ${session.participants}`,
    `Segments included: ${sorted.length}`,
    `Segments dead-lettered: ${session.stats.dead_letter}`,
    `Captures dropped: ${session.stats.dropped}`,
    `Segments still processing: ${session.stats.pending}`,
  ];

  lines.push('');

  if (sorted.length === 0) {
    lines.push('(No speech segments were transcribed.)');
  } else {
    for (const entry of sorted) {
      lines.push(
        `[${formatOffset(Date.parse(entry.timestamp) - session.startedAt.getTime())}] ${entry.displayName}: ${entry.text}`,
      );
    }
  }

  if (omitted.length > 0) {
    lines.push('', 'Omitted segments:');
    for (const result of omitted) {
      lines.push(
        `- #${result.jobId} ${result.status} ${formatOffset(Date.parse(result.timestamp) - session.startedAt.getTime())} user=${result.userId}${result.error ? ` (${result.error})` : ''}`,
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
