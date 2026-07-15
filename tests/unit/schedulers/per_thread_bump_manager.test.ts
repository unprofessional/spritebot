import type { Client } from 'discord.js';

import { PerThreadBumpManager } from '../../../src/schedulers/per_thread_bump_manager';

type TestableBumpManager = PerThreadBumpManager & {
  enqueueBump(task: () => Promise<void>): Promise<void>;
};

describe('PerThreadBumpManager drain', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('waits for queued bump work to finish', async () => {
    const manager = testableManager();
    const release = deferred<void>();
    const work = manager.enqueueBump(() => release.promise);
    await flushPromises();

    const drain = manager.drain(1_000);
    let drained = false;
    void drain.then((result) => {
      drained = result;
    });
    await flushPromises();
    expect(drained).toBe(false);

    release.resolve();
    await work;
    await expect(drain).resolves.toBe(true);
  });

  test('reports timeout when bump work stays in flight', async () => {
    jest.useFakeTimers();
    const manager = testableManager();
    const release = deferred<void>();
    const work = manager.enqueueBump(() => release.promise);
    await flushPromises();

    const drain = manager.drain(1_000);
    jest.advanceTimersByTime(1_000);
    await expect(drain).resolves.toBe(false);

    release.resolve();
    await work;
  });

  test('rejects new queued work after stop', async () => {
    const manager = testableManager();

    manager.stop();

    await expect(manager.enqueueBump(async () => undefined)).rejects.toThrow(
      'Bump manager is stopping.',
    );
  });
});

function testableManager(): TestableBumpManager {
  return new PerThreadBumpManager({} as Client) as unknown as TestableBumpManager;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
  let resolve!: (value?: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
