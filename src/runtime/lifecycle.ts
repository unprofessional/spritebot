export const DRAINING_REPLY = '⚠️ SPRITEbot is restarting. Please try again in a moment.';

export interface InFlightOperation {
  id: number;
  name: string;
  startedAt: Date;
}

export interface DrainSummary {
  idle: boolean;
  timedOut: boolean;
  inFlight: InFlightOperation[];
}

export interface ShutdownHook {
  name: string;
  hook: () => Promise<void> | void;
}

export interface GracefulShutdownOptions {
  waitTimeoutMs?: number;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
  stopVoice?: () => Promise<void> | void;
  sendShutdownNotification?: () => Promise<void> | void;
  destroyClient?: () => Promise<void> | void;
  closeDb?: () => Promise<void> | void;
}

export class DrainInProgressError extends Error {
  constructor(message = 'SPRITEbot is draining and cannot start new work.') {
    super(message);
    this.name = 'DrainInProgressError';
  }
}

type OperationOptions = {
  allowDuringDrain?: boolean;
};

const DEFAULT_WAIT_TIMEOUT_MS = 60_000;
const inFlight = new Map<number, InFlightOperation>();
const idleWaiters = new Set<() => void>();
const shutdownHooks: ShutdownHook[] = [];

let draining = false;
let operationSeq = 0;
let shutdownPromise: Promise<void> | null = null;

export function isDraining(): boolean {
  return draining;
}

export function beginDrain(reason = 'shutdown'): void {
  if (draining) return;
  draining = true;
  console.log(`[lifecycle] drain started: ${reason}`);
}

export function resetLifecycleForTests(): void {
  draining = false;
  operationSeq = 0;
  shutdownPromise = null;
  inFlight.clear();
  idleWaiters.clear();
  shutdownHooks.splice(0, shutdownHooks.length);
}

export function isDrainInProgressError(error: unknown): error is DrainInProgressError {
  return error instanceof DrainInProgressError;
}

export async function trackOperation<T>(
  name: string,
  fn: () => Promise<T> | T,
  options: OperationOptions = {},
): Promise<T> {
  if (draining && !options.allowDuringDrain) {
    throw new DrainInProgressError();
  }

  const id = ++operationSeq;
  inFlight.set(id, { id, name, startedAt: new Date() });

  try {
    return await fn();
  } finally {
    inFlight.delete(id);
    notifyIdleWaiters();
  }
}

export function getInFlightOperations(): InFlightOperation[] {
  return [...inFlight.values()].map((operation) => ({ ...operation }));
}

export async function waitForIdle(timeoutMs: number): Promise<DrainSummary> {
  if (inFlight.size === 0) {
    return { idle: true, timedOut: false, inFlight: [] };
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout;
    const done = (waiter: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      idleWaiters.delete(waiter);
      resolve();
    };
    const waiter = () => {
      if (inFlight.size > 0) return;
      done(waiter);
    };
    timeout = setTimeout(() => done(waiter), Math.max(0, timeoutMs));

    idleWaiters.add(waiter);
  });

  const remaining = getInFlightOperations();
  return {
    idle: remaining.length === 0,
    timedOut: remaining.length > 0,
    inFlight: remaining,
  };
}

export function registerShutdownHook(name: string, hook: () => Promise<void> | void): ShutdownHook {
  const registered = { name, hook };
  shutdownHooks.push(registered);
  return registered;
}

export function installSignalHandlers(options: GracefulShutdownOptions = {}): void {
  const handler = (signal: NodeJS.Signals) => {
    void runGracefulShutdown(signal, options);
  };

  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);
}

export async function runGracefulShutdown(
  signal: NodeJS.Signals | 'manual',
  options: GracefulShutdownOptions = {},
): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  const logger = options.logger ?? console;
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;

  shutdownPromise = (async () => {
    beginDrain(String(signal));

    for (const { name, hook } of shutdownHooks) {
      try {
        logger.log(`[lifecycle] running shutdown hook: ${name}`);
        await hook();
      } catch (error) {
        logger.warn(`[lifecycle] shutdown hook failed: ${name}`, error);
      }
    }

    const idle = await waitForIdle(waitTimeoutMs);
    if (idle.timedOut) {
      logger.warn(
        `[lifecycle] drain timed out with ${idle.inFlight.length} operation(s) still running: ` +
          idle.inFlight.map((operation) => operation.name).join(', '),
      );
    } else {
      logger.log('[lifecycle] in-flight operations drained.');
    }

    await runShutdownStep('voice shutdown', options.stopVoice, logger);
    await runShutdownStep('shutdown notification', options.sendShutdownNotification, logger);
    await runShutdownStep('discord client destroy', options.destroyClient, logger);
    await runShutdownStep('database close', options.closeDb, logger);

    process.exitCode = 0;
  })();

  return shutdownPromise;
}

async function runShutdownStep(
  name: string,
  step: (() => Promise<void> | void) | undefined,
  logger: Pick<Console, 'log' | 'warn'>,
): Promise<void> {
  if (!step) return;

  try {
    logger.log(`[lifecycle] ${name}...`);
    await step();
  } catch (error) {
    logger.warn(`[lifecycle] ${name} failed:`, error);
  }
}

function notifyIdleWaiters(): void {
  for (const waiter of idleWaiters) {
    waiter();
  }
}
