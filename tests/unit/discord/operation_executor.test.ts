import {
  DiscordOperationError,
  executeDiscordOperation,
  type DiscordOperationTelemetryEvent,
} from '../../../src/discord/operation_executor';
import { defineDiscordOperationPolicy } from '../../../src/discord/operation_policy';

describe('executeDiscordOperation', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('returns a successful value, passes operation context, and emits attempt/final telemetry', async () => {
    const onEvent = jest.fn<void, [DiscordOperationTelemetryEvent]>();
    const operation = jest.fn(async ({ signal, attempt }) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
      expect(attempt).toBe(1);
      return 'ok';
    });

    await expect(executeDiscordOperation(policy(), operation, { onEvent })).resolves.toBe('ok');

    expect(operation).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls.map(([event]) => [event.phase, event.outcome])).toEqual([
      ['attempt', 'success'],
      ['final', 'success'],
    ]);
  });

  test('aborts and rejects a hung operation at its deadline without a late unhandled rejection', async () => {
    jest.useFakeTimers();
    const onEvent = jest.fn<void, [DiscordOperationTelemetryEvent]>();
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    let signal: AbortSignal | undefined;
    let rejectLate: ((reason: unknown) => void) | undefined;
    const operation = jest.fn(
      ({ signal: operationSignal }: { signal: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          signal = operationSignal;
          rejectLate = reject;
        }),
    );

    try {
      const result = executeDiscordOperation(
        policy({ timeoutMs: 100, totalBudgetMs: 500 }),
        operation,
        { onEvent },
      );
      const rejection = expect(result).rejects.toMatchObject({
        name: 'DiscordOperationError',
        classified: { category: 'timeout' },
        attempts: 1,
      });
      await jest.advanceTimersByTimeAsync(100);

      await rejection;
      expect(signal?.aborted).toBe(true);

      rejectLate?.(new Error('late secret failure'));
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  test.each([10062, 40060])('never retries permanent interaction code %i', async (code) => {
    const operation = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('interaction failure'), { code, status: 400 }));
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(
      executeDiscordOperation(
        policy({ retry: 'safe-read', maxAttempts: 3 }),
        operation,
        quietDependencies({ sleep }),
      ),
    ).rejects.toBeInstanceOf(DiscordOperationError);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('retries a transient read only when safe-read is explicit', async () => {
    const transient = Object.assign(new Error('socket reset'), { code: 'ECONNRESET' });
    const neverOperation = jest.fn().mockRejectedValue(transient);

    await expect(
      executeDiscordOperation(policy(), neverOperation, quietDependencies()),
    ).rejects.toBeInstanceOf(DiscordOperationError);
    expect(neverOperation).toHaveBeenCalledTimes(1);

    const safeReadOperation = jest.fn().mockRejectedValueOnce(transient).mockResolvedValue('ok');
    const sleep = jest.fn().mockResolvedValue(undefined);
    await expect(
      executeDiscordOperation(
        policy({ retry: 'safe-read', maxAttempts: 2 }),
        safeReadOperation,
        quietDependencies({ sleep, random: () => 0 }),
      ),
    ).resolves.toBe('ok');
    expect(safeReadOperation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(100);
  });

  test('attempts a non-idempotent write once after a transient failure', async () => {
    const operation = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }));

    await expect(
      executeDiscordOperation(
        policy({ retry: 'never', maxAttempts: 5 }),
        operation,
        quietDependencies(),
      ),
    ).rejects.toMatchObject({ attempts: 1 });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  test('respects a supplied rate-limit delay for an explicitly retry-safe operation', async () => {
    const operation = jest
      .fn()
      .mockRejectedValueOnce({ status: 429, retryAfter: 750 })
      .mockResolvedValue('ok');
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(
      executeDiscordOperation(
        policy({ retry: 'safe-read', maxAttempts: 2, totalBudgetMs: 2_000 }),
        operation,
        quietDependencies({ sleep }),
      ),
    ).resolves.toBe('ok');

    expect(sleep).toHaveBeenCalledWith(750);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  test('caps retries at maxAttempts', async () => {
    const operation = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('dns failure'), { code: 'ENOTFOUND' }));

    await expect(
      executeDiscordOperation(
        policy({ retry: 'safe-read', maxAttempts: 2 }),
        operation,
        quietDependencies({ sleep: jest.fn().mockResolvedValue(undefined), random: () => 0 }),
      ),
    ).rejects.toMatchObject({ attempts: 2 });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  test('does not begin a retry whose delay would exhaust the total budget', async () => {
    let now = 0;
    const operation = jest.fn(async () => {
      now += 60;
      throw Object.assign(new Error('socket reset'), { code: 'ECONNRESET' });
    });
    const sleep = jest.fn().mockImplementation(async (ms: number) => {
      now += ms;
    });

    await expect(
      executeDiscordOperation(
        policy({ retry: 'safe-read', maxAttempts: 5, totalBudgetMs: 150 }),
        operation,
        quietDependencies({ now: () => now, sleep, random: () => 0 }),
      ),
    ).rejects.toMatchObject({ attempts: 1, elapsedMs: 60 });

    expect(sleep).not.toHaveBeenCalled();
    expect(operation).toHaveBeenCalledTimes(1);
  });

  test('uses injected random and sleep dependencies for deterministic backoff', async () => {
    const operation = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('dns failure'), { code: 'ENOTFOUND' }))
      .mockResolvedValue('ok');
    const sleep = jest.fn().mockResolvedValue(undefined);
    const random = jest.fn().mockReturnValue(0.5);

    await executeDiscordOperation(
      policy({ retry: 'safe-read', maxAttempts: 2 }),
      operation,
      quietDependencies({ sleep, random }),
    );

    expect(random).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(125);
  });

  test('emits one event per attempt and one final redacted failure event', async () => {
    const onEvent = jest.fn<void, [DiscordOperationTelemetryEvent]>();
    const operation = jest.fn().mockRejectedValue(
      Object.assign(
        new Error(
          'socket reset https://discord.com/api/v10/interactions/id/interaction-secret/callback',
        ),
        {
          code: 'ECONNRESET',
          headers: { Authorization: 'Bot bot-secret' },
          requestBody: { token: 'body-secret' },
        },
      ),
    );

    await expect(executeDiscordOperation(policy(), operation, { onEvent })).rejects.toBeInstanceOf(
      DiscordOperationError,
    );

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls.map(([event]) => [event.phase, event.outcome])).toEqual([
      ['attempt', 'failure'],
      ['final', 'failure'],
    ]);
    const serialized = JSON.stringify(onEvent.mock.calls);
    expect(serialized).toContain('transient_network');
    expect(serialized).not.toContain('interaction-secret');
    expect(serialized).not.toContain('bot-secret');
    expect(serialized).not.toContain('body-secret');
    expect(serialized).not.toContain('https://');
  });
});

function policy(
  overrides: Partial<ReturnType<typeof defineDiscordOperationPolicy>> = {},
): ReturnType<typeof defineDiscordOperationPolicy> {
  return defineDiscordOperationPolicy({
    operation: 'test.operation',
    timeoutMs: 1_000,
    totalBudgetMs: 5_000,
    ...overrides,
  });
}

function quietDependencies(
  overrides: {
    now?: () => number;
    random?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  return {
    onEvent: jest.fn<void, [DiscordOperationTelemetryEvent]>(),
    ...overrides,
  };
}
