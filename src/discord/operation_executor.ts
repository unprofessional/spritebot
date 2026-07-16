import {
  classifyDiscordError,
  DiscordOperationTimeoutError,
  type ClassifiedDiscordError,
} from './errors';
import { logDiscordOperationTelemetry, type DiscordOperationTelemetryLogInput } from './logging';
import type { DiscordOperationPolicy } from './operation_policy';

export interface DiscordOperationContext {
  signal: AbortSignal;
  attempt: number;
}

export type DiscordOperationTelemetryEvent = DiscordOperationTelemetryLogInput;

export interface DiscordOperationDependencies {
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onEvent?: (event: DiscordOperationTelemetryEvent) => void;
}

export class DiscordOperationError extends Error {
  readonly operation: string;
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly classified: ClassifiedDiscordError;

  constructor(
    operation: string,
    attempts: number,
    elapsedMs: number,
    classified: ClassifiedDiscordError,
  ) {
    super(classified.safeMessage);
    this.name = 'DiscordOperationError';
    this.operation = operation;
    this.attempts = attempts;
    this.elapsedMs = elapsedMs;
    this.classified = classified;
  }
}

const initialBackoffMs = 100;
const maximumBackoffMs = 1_000;
const jitterRangeMs = 50;

export async function executeDiscordOperation<T>(
  policy: DiscordOperationPolicy,
  operation: (context: DiscordOperationContext) => Promise<T>,
  dependencies: DiscordOperationDependencies = {},
): Promise<T> {
  const now = dependencies.now ?? Date.now;
  const random = dependencies.random ?? Math.random;
  const sleep = dependencies.sleep ?? defaultSleep;
  const onEvent = dependencies.onEvent ?? logDiscordOperationTelemetry;
  const startedAt = now();
  let attempts = 0;

  while (attempts < policy.maxAttempts) {
    const remainingBudgetMs = policy.totalBudgetMs - elapsed(now, startedAt);
    if (remainingBudgetMs <= 0) {
      return fail(
        policy,
        attempts,
        elapsed(now, startedAt),
        classifyDiscordError(new DiscordOperationTimeoutError(policy.totalBudgetMs)),
        onEvent,
      );
    }

    attempts += 1;
    const attemptStartedAt = now();

    try {
      const value = await runAttempt(
        Math.min(policy.timeoutMs, remainingBudgetMs),
        attempts,
        operation,
      );
      const attemptElapsedMs = elapsed(now, attemptStartedAt);
      onEvent(event('attempt', 'success', policy.operation, attempts, attemptElapsedMs));
      onEvent(event('final', 'success', policy.operation, attempts, elapsed(now, startedAt)));
      return value;
    } catch (error) {
      const classified = classifyDiscordError(error);
      onEvent(
        event(
          'attempt',
          'failure',
          policy.operation,
          attempts,
          elapsed(now, attemptStartedAt),
          classified,
        ),
      );

      if (!mayRetry(policy, classified, attempts)) {
        return fail(policy, attempts, elapsed(now, startedAt), classified, onEvent);
      }

      const delayMs = retryDelay(classified, attempts, random);
      const remainingAfterAttemptMs = policy.totalBudgetMs - elapsed(now, startedAt);
      if (delayMs >= remainingAfterAttemptMs) {
        return fail(policy, attempts, elapsed(now, startedAt), classified, onEvent);
      }

      await sleep(delayMs);
      if (elapsed(now, startedAt) >= policy.totalBudgetMs) {
        return fail(policy, attempts, elapsed(now, startedAt), classified, onEvent);
      }
    }
  }

  throw new Error('Discord operation executor reached an unreachable state.');
}

async function runAttempt<T>(
  timeoutMs: number,
  attempt: number,
  operation: (context: DiscordOperationContext) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new DiscordOperationTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation({ signal: controller.signal, attempt })),
      timeoutPromise,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function mayRetry(
  policy: DiscordOperationPolicy,
  classified: ClassifiedDiscordError,
  attempts: number,
): boolean {
  return policy.retry !== 'never' && classified.retryable && attempts < policy.maxAttempts;
}

function retryDelay(
  classified: ClassifiedDiscordError,
  attempt: number,
  random: () => number,
): number {
  if (classified.category === 'rate_limited' && classified.retryAfterMs !== undefined) {
    return classified.retryAfterMs;
  }

  const backoff = Math.min(initialBackoffMs * 2 ** (attempt - 1), maximumBackoffMs);
  const jitter = Math.floor(clampRandom(random()) * jitterRangeMs);
  return backoff + jitter;
}

function clampRandom(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function fail(
  policy: DiscordOperationPolicy,
  attempts: number,
  elapsedMs: number,
  classified: ClassifiedDiscordError,
  onEvent: (event: DiscordOperationTelemetryEvent) => void,
): never {
  onEvent(event('final', 'failure', policy.operation, attempts, elapsedMs, classified));
  throw new DiscordOperationError(policy.operation, attempts, elapsedMs, classified);
}

function event(
  phase: DiscordOperationTelemetryEvent['phase'],
  outcome: DiscordOperationTelemetryEvent['outcome'],
  operation: string,
  attempt: number,
  elapsedMs: number,
  classified?: ClassifiedDiscordError,
): DiscordOperationTelemetryEvent {
  return {
    phase,
    outcome,
    operation,
    attempt,
    elapsedMs,
    ...(classified === undefined ? {} : { classified }),
  };
}

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.floor(now() - startedAt));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
