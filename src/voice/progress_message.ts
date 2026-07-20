import { defineDiscordOperationPolicy } from '../discord/operation_policy';
import { executeDiscordSdkMethod } from '../discord/sdk_operations';
import type { QueueStats } from './durable_queue/types';

export type TranscriptionProgressPhase = 'processing' | 'complete';

export type TranscriptionProgressMessage = {
  update(stats: QueueStats, options?: { force?: boolean }): Promise<void>;
  complete(stats: QueueStats): Promise<void>;
};

type EditableMessage = {
  edit(payload: { content: string }): Promise<unknown>;
};

type ProgressChannel = {
  send(payload: { content: string }): Promise<EditableMessage>;
};

const defaultBarWidth = 12;
const defaultMinEditIntervalMs = 5_000;
const progressSendPolicy = defineDiscordOperationPolicy({
  operation: 'voice.send-progress',
  timeoutMs: 3_000,
  totalBudgetMs: 3_000,
});
const progressEditPolicy = defineDiscordOperationPolicy({
  operation: 'voice.edit-progress',
  timeoutMs: 2_000,
  totalBudgetMs: 5_000,
  retry: 'idempotent-write',
  maxAttempts: 2,
});

export async function createTranscriptionProgressMessage(
  channel: ProgressChannel,
  stats: QueueStats,
  { minEditIntervalMs = defaultMinEditIntervalMs }: { minEditIntervalMs?: number } = {},
): Promise<TranscriptionProgressMessage> {
  const initialContent = formatTranscriptionProgress(stats, { phase: 'processing' });
  const message = await executeDiscordSdkMethod(progressSendPolicy, channel, 'send', {
    content: initialContent,
  });
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

    await executeDiscordSdkMethod(progressEditPolicy, message, 'edit', { content });
    lastContent = content;
    lastEditAt = Date.now();
  };

  return {
    update: async (stats, options) => {
      await edit(formatTranscriptionProgress(stats, { phase: 'processing' }), options);
    },
    complete: async (stats) => {
      await edit(formatTranscriptionProgress(stats, { phase: 'complete' }), { force: true });
    },
  };
}

export function formatTranscriptionProgress(
  stats: QueueStats,
  { phase }: { phase: TranscriptionProgressPhase },
): string {
  const total = totalSegmentCount(stats);
  const transcribed = stats.done;
  const percent = progressPercent(stats);

  return [
    progressTitle(phase),
    `${progressBar(percent)} ${percent}% (${transcribed}/${total} transcribed)`,
    formatQueueSummary(stats),
  ].join('\n');
}

export function formatQueueSummary(stats: QueueStats): string {
  return [
    pluralize(stats.committed, 'queued'),
    `${stats.processing} in progress`,
    pluralize(stats.done, 'transcribed'),
    pluralize(stats.failed, 'awaiting retry'),
    pluralize(stats.dead_letter, 'dead letter'),
    pluralize(stats.dropped, 'capture dropped'),
  ].join(' · ');
}

function progressTitle(phase: TranscriptionProgressPhase): string {
  if (phase === 'complete') return 'Transcription complete. Final transcript posted below.';
  return 'Transcription processing...';
}

function progressBar(percent: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * defaultBarWidth);
  return `${'█'.repeat(filled)}${'░'.repeat(defaultBarWidth - filled)}`;
}

function progressPercent(stats: QueueStats): number {
  const total = totalSegmentCount(stats);
  if (total === 0) return 100;
  return Math.round((stats.done / total) * 100);
}

function totalSegmentCount(stats: QueueStats): number {
  return stats.total + stats.dropped;
}

function pluralize(count: number, word: string): string {
  return `${count} ${word}`;
}
