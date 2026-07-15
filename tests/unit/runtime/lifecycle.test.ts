import {
  beginDrain,
  isDraining,
  registerShutdownHook,
  resetLifecycleForTests,
  runGracefulShutdown,
  trackOperation,
  waitForIdle,
} from '../../../src/runtime/lifecycle';

describe('runtime lifecycle', () => {
  afterEach(() => {
    resetLifecycleForTests();
    process.exitCode = undefined;
  });

  test('rejects new work once draining begins', async () => {
    beginDrain('test');

    await expect(trackOperation('late-work', async () => undefined)).rejects.toThrow(
      'SPRITEbot is draining',
    );
    await expect(
      trackOperation('shutdown-work', async () => 'ok', { allowDuringDrain: true }),
    ).resolves.toBe('ok');
  });

  test('waits for in-flight operations to settle', async () => {
    let release!: () => void;
    const active = trackOperation(
      'slow-work',
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const waiting = waitForIdle(1_000);
    release();
    await active;

    await expect(waiting).resolves.toEqual({
      idle: true,
      timedOut: false,
      inFlight: [],
    });
  });

  test('runs graceful shutdown in the expected order', async () => {
    const order: string[] = [];

    registerShutdownHook('scheduler', () => {
      order.push('hook');
    });

    await runGracefulShutdown('SIGTERM', {
      waitTimeoutMs: 100,
      logger: {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
      stopVoice: () => {
        order.push('voice');
      },
      sendShutdownNotification: () => {
        order.push('notify');
      },
      destroyClient: () => {
        order.push('destroy');
      },
      closeDb: () => {
        order.push('db');
      },
    });

    expect(isDraining()).toBe(true);
    expect(order).toEqual(['hook', 'voice', 'notify', 'destroy', 'db']);
    expect(process.exitCode).toBe(0);
  });
});
