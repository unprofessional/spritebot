import type { TranscriptionQueueStats } from './transcription_queue';

export type TranscriptionProgressPhase = 'processing' | 'complete' | 'timed-out';

export type TranscriptionProgressMessage = {
  update(stats: TranscriptionQueueStats, options?: { force?: boolean }): Promise<void>;
  complete(stats: TranscriptionQueueStats, options: { timedOut: boolean }): Promise<void>;
};

type EditableMessage = {
  edit(payload: { content: string }): Promise<unknown>;
};

type ProgressChannel = {
  send(payload: { content: string }): Promise<EditableMessage>;
};

const defaultBarWidth = 12;
const defaultMinEditIntervalMs = 5_000;

export async function createTranscriptionProgressMessage(
  channel: ProgressChannel,
  stats: TranscriptionQueueStats,
  { minEditIntervalMs = defaultMinEditIntervalMs }: { minEditIntervalMs?: number } = {},
): Promise<TranscriptionProgressMessage> {
  const initialContent = formatTranscriptionProgress(stats, { phase: 'processing' });
  const message = await channel.send({ content: initialContent });
  return buildTranscriptionProgressMessage(message, initialContent, { minEditIntervalMs });
}

export function createNoopTranscriptionProgressMessage(): TranscriptionProgressMessage {
  return {
    update: async () => undefined,
    complete: async () => undefined,
  };
}

export function buildTranscriptionProgressMessage(
  message: EditableMessage,
  initialContent: string,
  { minEditIntervalMs = defaultMinEditIntervalMs }: { minEditIntervalMs?: number } = {},
): TranscriptionProgressMessage {
  let lastContent = initialContent;
  let lastEditAt = Date.now();

  const edit = async (content: string, { force = false }: { force?: boolean } = {}) => {
    if (content === lastContent) return;
    if (!force && Date.now() - lastEditAt < minEditIntervalMs) return;

    await message.edit({ content });
    lastContent = content;
    lastEditAt = Date.now();
  };

  return {
    update: async (stats, options) => {
      await edit(formatTranscriptionProgress(stats, { phase: 'processing' }), options);
    },
    complete: async (stats, { timedOut }) => {
      await edit(
        formatTranscriptionProgress(stats, {
          phase: timedOut ? 'timed-out' : 'complete',
        }),
        { force: true },
      );
    },
  };
}

export function formatTranscriptionProgress(
  stats: TranscriptionQueueStats,
  { phase }: { phase: TranscriptionProgressPhase },
): string {
  const total = totalSegmentCount(stats);
  const resolved = resolvedSegmentCount(stats);
  const percent = progressPercent(stats);

  return [
    progressTitle(phase),
    `${progressBar(percent)} ${percent}% (${resolved}/${total} segments)`,
    formatQueueSummary(stats),
  ].join('\n');
}

export function formatQueueSummary(stats: TranscriptionQueueStats): string {
  return [
    pluralize(stats.queued, 'queued'),
    `${stats.transcribing} in progress`,
    pluralize(stats.done, 'complete'),
    pluralize(stats.failed, 'failed'),
    `${stats.timeout} timed out`,
  ].join(', ');
}

function progressTitle(phase: TranscriptionProgressPhase): string {
  if (phase === 'complete') return 'Transcription complete. Final transcript posted below.';
  if (phase === 'timed-out')
    return 'Transcription drain timed out. Latest transcript posted below.';
  return 'Transcription still processing...';
}

function progressBar(percent: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * defaultBarWidth);
  return `${'█'.repeat(filled)}${'░'.repeat(defaultBarWidth - filled)}`;
}

function progressPercent(stats: TranscriptionQueueStats): number {
  const total = totalSegmentCount(stats);
  if (total === 0) return 100;
  return Math.round((resolvedSegmentCount(stats) / total) * 100);
}

function totalSegmentCount(stats: TranscriptionQueueStats): number {
  return stats.queued + stats.transcribing + stats.done + stats.failed + stats.timeout;
}

function resolvedSegmentCount(stats: TranscriptionQueueStats): number {
  return stats.done + stats.failed + stats.timeout;
}

function pluralize(count: number, word: string): string {
  return `${count} ${word}`;
}
