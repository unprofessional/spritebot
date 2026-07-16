import { classifyDiscordError, type ClassifiedDiscordError } from './errors';

export interface DiscordFailureLogInput {
  operation: string;
  error: unknown;
  attempt: number;
  elapsedMs: number;
  commandName?: string;
  customId?: string;
  interactionKind?: string;
  acknowledgementMethod?: string;
  acknowledgementMs?: number;
}

export type DiscordLogSink = (line: string) => void;

export interface DiscordOperationTelemetryLogInput {
  phase: 'attempt' | 'final';
  outcome: 'success' | 'failure';
  operation: string;
  attempt: number;
  elapsedMs: number;
  classified?: ClassifiedDiscordError;
  commandName?: string;
  customId?: string;
  interactionKind?: string;
  acknowledgementMethod?: string;
  acknowledgementMs?: number;
}

const safeLabel = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export function formatDiscordFailureLog(input: DiscordFailureLogInput): string {
  const error = classifyDiscordError(input.error);
  const operation = safeMetadata(input.operation);
  const commandName = safeMetadata(input.commandName);
  const customIdPrefix = safeCustomIdPrefix(input.customId);
  const interactionKind = safeMetadata(input.interactionKind);
  const acknowledgementMethod = safeMetadata(input.acknowledgementMethod);

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
    ...(interactionKind ? [`interactionKind=${interactionKind}`] : []),
    ...(acknowledgementMethod ? [`acknowledgementMethod=${acknowledgementMethod}`] : []),
    ...(input.acknowledgementMs === undefined
      ? []
      : [`acknowledgementMs=${safeNonNegativeInteger(input.acknowledgementMs)}`]),
  ].join(' ');
}

export function logDiscordFailure(
  input: DiscordFailureLogInput,
  sink: DiscordLogSink = console.warn,
): void {
  sink(formatDiscordFailureLog(input));
}

export function formatDiscordOperationTelemetryLog(
  input: DiscordOperationTelemetryLogInput,
): string {
  const operation = safeMetadata(input.operation);
  const commandName = safeMetadata(input.commandName);
  const customIdPrefix = safeCustomIdPrefix(input.customId);
  const interactionKind = safeMetadata(input.interactionKind);
  const acknowledgementMethod = safeMetadata(input.acknowledgementMethod);

  return [
    '[discord-operation]',
    `phase=${input.phase}`,
    `outcome=${input.outcome}`,
    `operation=${operation ?? 'unknown'}`,
    `attempt=${safeNonNegativeInteger(input.attempt)}`,
    `elapsedMs=${safeNonNegativeInteger(input.elapsedMs)}`,
    ...(interactionKind ? [`interactionKind=${interactionKind}`] : []),
    ...(commandName ? [`command=${commandName}`] : []),
    ...(customIdPrefix ? [`customIdPrefix=${customIdPrefix}`] : []),
    ...(acknowledgementMethod ? [`acknowledgementMethod=${acknowledgementMethod}`] : []),
    ...(input.acknowledgementMs === undefined
      ? []
      : [`acknowledgementMs=${safeNonNegativeInteger(input.acknowledgementMs)}`]),
    ...(input.classified
      ? [
          `category=${input.classified.category}`,
          `retryable=${input.classified.retryable}`,
          `code=${input.classified.code ?? 'unknown'}`,
          `status=${input.classified.status ?? 'unknown'}`,
          ...(input.classified.retryAfterMs === undefined
            ? []
            : [`retryAfterMs=${input.classified.retryAfterMs}`]),
        ]
      : []),
  ].join(' ');
}

export function logDiscordOperationTelemetry(
  input: DiscordOperationTelemetryLogInput,
  sink: DiscordLogSink = input.outcome === 'failure' ? console.warn : console.debug,
): void {
  sink(formatDiscordOperationTelemetryLog(input));
}

export function interactionMetadataString(
  interaction: unknown,
  key: 'commandName' | 'customId',
): string | undefined {
  if (!interaction || typeof interaction !== 'object') return undefined;
  const value = (interaction as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

export function interactionKind(interaction: unknown): string {
  if (!interaction || typeof interaction !== 'object') return 'unknown';
  const candidate = interaction as Record<string, unknown>;
  const checks: Array<[string, string]> = [
    ['isChatInputCommand', 'chat-input-command'],
    ['isMessageContextMenuCommand', 'message-context-command'],
    ['isButton', 'button'],
    ['isStringSelectMenu', 'string-select'],
    ['isModalSubmit', 'modal-submit'],
  ];
  for (const [method, kind] of checks) {
    const check = candidate[method];
    if (typeof check === 'function' && check.call(interaction)) return kind;
  }

  const type = candidate.type;
  return typeof type === 'number' ? `type-${type}` : 'unknown';
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
