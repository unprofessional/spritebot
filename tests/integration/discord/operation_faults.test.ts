import {
  executeDiscordOperation,
  type DiscordOperationTelemetryEvent,
} from '../../../src/discord/operation_executor';
import { defineDiscordOperationPolicy } from '../../../src/discord/operation_policy';
import {
  beginDrain,
  getInFlightOperations,
  resetLifecycleForTests,
  trackOperation,
} from '../../../src/runtime/lifecycle';

describe('Discord operation fault contracts', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
    resetLifecycleForTests();
  });

  test('contains a delayed success after the local timeout without retrying or rejecting late', async () => {
    await expectNoUnhandledRejection(async () => {
      const late = deferred<string>();
      const operation = jest.fn(() => late.promise);
      const result = executeDiscordOperation(
        policy({ timeoutMs: 100, totalBudgetMs: 100 }),
        operation,
        quietDependencies(),
      );
      const rejection = expect(result).rejects.toMatchObject({
        attempts: 1,
        classified: { category: 'timeout' },
      });

      await jest.advanceTimersByTimeAsync(100);
      await rejection;
      late.resolve('accepted after timeout');
      await Promise.resolve();

      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  test('never retries a non-idempotent send after a connection reset', async () => {
    await expectNoUnhandledRejection(async () => {
      const send = jest.fn().mockRejectedValue(connectionReset());

      await expect(
        executeDiscordOperation(
          policy({ retry: 'never', maxAttempts: 5 }),
          send,
          quietDependencies(),
        ),
      ).rejects.toMatchObject({
        attempts: 1,
        classified: { category: 'transient_network' },
      });

      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  test('retries a safe read after a connection reset only within its attempt policy', async () => {
    await expectNoUnhandledRejection(async () => {
      const read = jest.fn().mockRejectedValue(connectionReset());
      const sleep = jest.fn().mockResolvedValue(undefined);

      await expect(
        executeDiscordOperation(
          policy({ retry: 'safe-read', maxAttempts: 2 }),
          read,
          quietDependencies({ sleep, random: () => 0 }),
        ),
      ).rejects.toMatchObject({ attempts: 2 });

      expect(read).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledWith(100);
    });
  });

  test('honors the Discord 429 retry delay before a safe retry', async () => {
    await expectNoUnhandledRejection(async () => {
      const read = jest
        .fn()
        .mockRejectedValueOnce({ status: 429, retryAfter: 750 })
        .mockResolvedValue('ok');
      const result = executeDiscordOperation(
        policy({ retry: 'safe-read', maxAttempts: 2, totalBudgetMs: 2_000 }),
        read,
        quietDependencies(),
      );

      await Promise.resolve();
      expect(read).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(749);
      expect(read).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);

      await expect(result).resolves.toBe('ok');
      expect(read).toHaveBeenCalledTimes(2);
    });
  });

  test.each([401, 403])('treats HTTP %i as permanent even for a safe read', async (status) => {
    await expectNoUnhandledRejection(async () => {
      const read = jest.fn().mockRejectedValue({ status });

      await expect(
        executeDiscordOperation(
          policy({ retry: 'safe-read', maxAttempts: 3 }),
          read,
          quietDependencies(),
        ),
      ).rejects.toMatchObject({
        attempts: 1,
        classified: { category: 'authentication_or_permission' },
      });

      expect(read).toHaveBeenCalledTimes(1);
    });
  });

  test('lets active work settle when drain begins and rejects new operations', async () => {
    await expectNoUnhandledRejection(async () => {
      const release = deferred<string>();
      const active = trackOperation('discord:active-read', () =>
        executeDiscordOperation(policy(), () => release.promise, quietDependencies()),
      );
      await Promise.resolve();
      expect(getInFlightOperations()).toEqual([
        expect.objectContaining({ name: 'discord:active-read' }),
      ]);

      beginDrain('fault-test');
      await expect(trackOperation('discord:late-read', async () => 'not-started')).rejects.toThrow(
        'SPRITEbot is draining',
      );

      release.resolve('ok');
      await expect(active).resolves.toBe('ok');
      expect(getInFlightOperations()).toEqual([]);
    });
  });
});

function policy(
  overrides: Partial<ReturnType<typeof defineDiscordOperationPolicy>> = {},
): ReturnType<typeof defineDiscordOperationPolicy> {
  return defineDiscordOperationPolicy({
    operation: 'test.integration-fault',
    timeoutMs: 1_000,
    totalBudgetMs: 5_000,
    ...overrides,
  });
}

function quietDependencies(
  overrides: {
    random?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  return {
    onEvent: jest.fn<void, [DiscordOperationTelemetryEvent]>(),
    ...overrides,
  };
}

function connectionReset(): Error & { code: string } {
  return Object.assign(new Error('socket reset'), { code: 'ECONNRESET' });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function expectNoUnhandledRejection(work: () => Promise<void>): Promise<void> {
  const listenerCount = process.listenerCount('unhandledRejection');
  const unhandled: unknown[] = [];
  const listener = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', listener);

  try {
    await work();
    await Promise.resolve();
    expect(unhandled).toEqual([]);
  } finally {
    process.off('unhandledRejection', listener);
    expect(process.listenerCount('unhandledRejection')).toBe(listenerCount);
  }
}
