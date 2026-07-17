import { createHmac, randomBytes, randomUUID } from 'node:crypto';

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

export interface DiscordInteractionLifecycleLogInput {
  phase: 'received' | 'completed';
  outcome: 'success' | 'failure';
  elapsedMs: number;
  gatewayLagMs?: number;
  guardMs?: number;
  handlerMs?: number;
  state?: string;
  commandName?: string;
  customId?: string;
  interactionKind?: string;
  interactionKey?: string;
  flowKey?: string;
}

export interface DiscordModalFlowLogInput {
  event: 'fast' | 'prepared' | 'activation' | 'expired';
  elapsedMs: number;
  interactionKey?: string;
  flowKey?: string;
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
  callbackStartMs?: number;
  interactionKey?: string;
  flowKey?: string;
}

const safeLabel = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const telemetryCorrelationSecret = randomBytes(32);
const MODAL_FLOW_TTL_MS = 15 * 60 * 1_000;
const MODAL_FLOW_LIMIT = 1_000;
const modalFlows = new Map<string, { expiresAt: number; flowKey: string }>();

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

export function formatDiscordInteractionLifecycleLog(
  input: DiscordInteractionLifecycleLogInput,
): string {
  const commandName = safeMetadata(input.commandName);
  const customIdPrefix = safeCustomIdPrefix(input.customId);
  const kind = safeMetadata(input.interactionKind);
  const state = safeMetadata(input.state);
  const interactionKey = safeMetadata(input.interactionKey);
  const flowKey = safeMetadata(input.flowKey);

  return [
    '[discord-interaction]',
    `phase=${input.phase}`,
    `outcome=${input.outcome}`,
    `elapsedMs=${safeNonNegativeInteger(input.elapsedMs)}`,
    ...(input.gatewayLagMs === undefined
      ? []
      : [`gatewayLagMs=${safeNonNegativeInteger(input.gatewayLagMs)}`]),
    ...(input.guardMs === undefined ? [] : [`guardMs=${safeNonNegativeInteger(input.guardMs)}`]),
    ...(input.handlerMs === undefined
      ? []
      : [`handlerMs=${safeNonNegativeInteger(input.handlerMs)}`]),
    ...(kind ? [`interactionKind=${kind}`] : []),
    ...(commandName ? [`command=${commandName}`] : []),
    ...(customIdPrefix ? [`customIdPrefix=${customIdPrefix}`] : []),
    ...(state ? [`state=${state}`] : []),
    ...(interactionKey ? [`interactionKey=${interactionKey}`] : []),
    ...(flowKey ? [`flowKey=${flowKey}`] : []),
  ].join(' ');
}

export function logDiscordInteractionLifecycle(
  input: DiscordInteractionLifecycleLogInput,
  sink: DiscordLogSink = input.outcome === 'failure' ? console.warn : console.debug,
): void {
  sink(formatDiscordInteractionLifecycleLog(input));
}

export function formatDiscordModalFlowLog(input: DiscordModalFlowLogInput): string {
  const interactionKey = safeMetadata(input.interactionKey);
  const flowKey = safeMetadata(input.flowKey);
  return [
    '[discord-modal]',
    `event=${input.event}`,
    `elapsedMs=${safeNonNegativeInteger(input.elapsedMs)}`,
    ...(interactionKey ? [`interactionKey=${interactionKey}`] : []),
    ...(flowKey ? [`flowKey=${flowKey}`] : []),
  ].join(' ');
}

export function logDiscordModalFlow(
  input: DiscordModalFlowLogInput,
  sink: DiscordLogSink = console.debug,
): void {
  sink(formatDiscordModalFlowLog(input));
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
    ...(input.callbackStartMs === undefined
      ? []
      : [`callbackStartMs=${safeNonNegativeInteger(input.callbackStartMs)}`]),
    ...(safeMetadata(input.interactionKey) ? [`interactionKey=${input.interactionKey}`] : []),
    ...(safeMetadata(input.flowKey) ? [`flowKey=${input.flowKey}`] : []),
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

export function interactionTelemetryKey(interaction: unknown): string | undefined {
  if (!interaction || typeof interaction !== 'object') return undefined;
  const id = (interaction as Record<string, unknown>).id;
  return typeof id === 'string' ? correlationKey('interaction', id) : undefined;
}

export function registerModalFlowTelemetry(
  modalOrCustomId: unknown,
  interaction: unknown,
): string | undefined {
  const customId = extractCustomId(modalOrCustomId);
  const userId = interactionUserId(interaction);
  if (!customId || !userId) return undefined;

  pruneModalFlows();
  while (modalFlows.size >= MODAL_FLOW_LIMIT) {
    const oldestKey = modalFlows.keys().next().value as string | undefined;
    if (!oldestKey) break;
    modalFlows.delete(oldestKey);
  }

  const flowKey = correlationKey('modal-flow', randomUUID());
  modalFlows.set(modalFlowLookupKey(userId, customId), {
    expiresAt: Date.now() + MODAL_FLOW_TTL_MS,
    flowKey,
  });
  return flowKey;
}

export function resolveModalFlowTelemetry(
  customId: string,
  interaction: unknown,
): string | undefined {
  const userId = interactionUserId(interaction);
  if (!userId) return undefined;
  pruneModalFlows();
  return modalFlows.get(modalFlowLookupKey(userId, customId))?.flowKey;
}

export function interactionGatewayLagMs(
  interaction: unknown,
  now = Date.now(),
): number | undefined {
  if (!interaction || typeof interaction !== 'object') return undefined;
  const createdTimestamp = (interaction as Record<string, unknown>).createdTimestamp;
  if (typeof createdTimestamp !== 'number' || !Number.isFinite(createdTimestamp)) return undefined;
  return Math.max(0, now - createdTimestamp);
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

function correlationKey(namespace: string, value: string): string {
  return createHmac('sha256', telemetryCorrelationSecret)
    .update(namespace)
    .update('\0')
    .update(value)
    .digest('hex')
    .slice(0, 12);
}

function extractCustomId(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;

  const direct = (value as Record<string, unknown>).customId;
  if (typeof direct === 'string') return direct;

  const toJSON = (value as { toJSON?: () => unknown }).toJSON;
  if (typeof toJSON !== 'function') return undefined;
  const json = toJSON.call(value);
  if (!json || typeof json !== 'object') return undefined;
  const customId = (json as Record<string, unknown>).custom_id;
  return typeof customId === 'string' ? customId : undefined;
}

function interactionUserId(interaction: unknown): string | undefined {
  if (!interaction || typeof interaction !== 'object') return undefined;
  const user = (interaction as Record<string, unknown>).user;
  if (!user || typeof user !== 'object') return undefined;
  const id = (user as Record<string, unknown>).id;
  return typeof id === 'string' ? id : undefined;
}

function modalFlowLookupKey(userId: string, customId: string): string {
  return `${userId}\0${customId}`;
}

function pruneModalFlows(): void {
  const now = Date.now();
  for (const [key, entry] of modalFlows) {
    if (entry.expiresAt <= now) modalFlows.delete(key);
  }
}
