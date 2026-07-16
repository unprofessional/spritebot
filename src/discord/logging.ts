import { classifyDiscordError } from './errors';

export interface DiscordFailureLogInput {
  operation: string;
  error: unknown;
  attempt: number;
  elapsedMs: number;
  commandName?: string;
  customId?: string;
}

export type DiscordLogSink = (line: string) => void;

const safeLabel = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export function formatDiscordFailureLog(input: DiscordFailureLogInput): string {
  const error = classifyDiscordError(input.error);
  const operation = safeMetadata(input.operation);
  const commandName = safeMetadata(input.commandName);
  const customIdPrefix = safeCustomIdPrefix(input.customId);

  return [
    '[discord-operation] failure',
    `operation=${operation ?? 'unknown'}`,
    `category=${error.category}`,
    `retryable=${error.retryable}`,
    `code=${error.code ?? 'unknown'}`,
    `status=${error.status ?? 'unknown'}`,
    `attempt=${safeNonNegativeInteger(input.attempt)}`,
    `elapsedMs=${safeNonNegativeInteger(input.elapsedMs)}`,
    ...(error.retryAfterMs === undefined ? [] : [`retryAfterMs=${error.retryAfterMs}`]),
    ...(commandName ? [`command=${commandName}`] : []),
    ...(customIdPrefix ? [`customIdPrefix=${customIdPrefix}`] : []),
  ].join(' ');
}

export function logDiscordFailure(
  input: DiscordFailureLogInput,
  sink: DiscordLogSink = console.warn,
): void {
  sink(formatDiscordFailureLog(input));
}

function safeMetadata(value: string | undefined): string | undefined {
  if (!value || !safeLabel.test(value)) return undefined;
  return value;
}

function safeCustomIdPrefix(customId: string | undefined): string | undefined {
  if (!customId) return undefined;
  return safeMetadata(customId.split(':', 1)[0]);
}

function safeNonNegativeInteger(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
