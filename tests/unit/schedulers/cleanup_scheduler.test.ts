import {
  runCleanupOnce,
  startCleanupScheduler,
  stopCleanupScheduler,
  totalPurged,
} from '../../../src/schedulers/cleanup_scheduler';
import type { HousekeepingPurgeResult } from '../../../src/services/admin_housekeeping.service';

function createLogger() {
  return {
    log: jest.fn(),
    warn: jest.fn(),
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('cleanup_scheduler', () => {
  afterEach(() => {
    stopCleanupScheduler();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('summarizes cleanup counts', () => {
    expect(
      totalPurged([
        { category: 'soft-deleted-characters', label: 'Characters', count: 2 },
        { category: 'stale-proxy-messages', label: 'Proxy Messages', count: 3 },
      ]),
    ).toBe(5);
  });

  test('runs cleanup once and logs category counts', async () => {
    const logger = createLogger();
    const results: HousekeepingPurgeResult[] = [
      { category: 'soft-deleted-characters', label: 'Characters', count: 1 },
      { category: 'stale-proxy-messages', label: 'Proxy Messages', count: 0 },
    ];
    const cleanup = jest.fn().mockResolvedValue(results);

    await expect(runCleanupOnce({ cleanup, logger })).resolves.toBe(results);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      '[cleanup] purged 1 row(s): soft-deleted-characters=1 stale-proxy-messages=0',
    );
  });

  test('starts on an interval and catches cleanup failures', async () => {
    jest.useFakeTimers();
    const logger = createLogger();
    const cleanup = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('database unavailable'));

    startCleanupScheduler({
      cleanup,
      intervalHours: 1,
      logger,
      registerSignals: false,
    });

    await flushPromises();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith('[cleanup] no eligible rows.');
    expect(logger.log).toHaveBeenCalledWith('[cleanup] scheduler started; interval=1h');

    jest.advanceTimersByTime(60 * 60 * 1000);
    await flushPromises();

    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      '[cleanup] scheduled cleanup failed:',
      expect.any(Error),
    );
  });
});
