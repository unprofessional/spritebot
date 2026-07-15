// src/schedulers/cleanup_scheduler.ts

import { cleanupIntervalHours } from '../config/env_config';
import {
  purgeSafeOrphans,
  type HousekeepingPurgeResult,
} from '../services/admin_housekeeping.service';

const HOURS_TO_MS = 60 * 60 * 1000;

interface CleanupLogger {
  log(message: string): void;
  warn(message: string, error?: unknown): void;
}

interface SchedulerOptions {
  cleanup?: () => Promise<HousekeepingPurgeResult[]>;
  intervalHours?: number;
  logger?: CleanupLogger;
  runImmediately?: boolean;
}

let cleanupHandle: NodeJS.Timeout | null = null;
let activeCleanupRun: Promise<HousekeepingPurgeResult[]> | null = null;

function formatResults(results: HousekeepingPurgeResult[]): string {
  return results.map((result) => `${result.category}=${result.count}`).join(' ');
}

export function totalPurged(results: HousekeepingPurgeResult[]): number {
  return results.reduce((sum, result) => sum + result.count, 0);
}

export async function runCleanupOnce({
  cleanup = purgeSafeOrphans,
  logger = console,
}: Pick<SchedulerOptions, 'cleanup' | 'logger'> = {}): Promise<HousekeepingPurgeResult[]> {
  const results = await cleanup();
  const total = totalPurged(results);

  if (total === 0) {
    logger.log('[cleanup] no eligible rows.');
  } else {
    logger.log(`[cleanup] purged ${total} row(s): ${formatResults(results)}`);
  }

  return results;
}

export function startCleanupScheduler({
  cleanup = purgeSafeOrphans,
  intervalHours = cleanupIntervalHours,
  logger = console,
  runImmediately = true,
}: SchedulerOptions = {}): void {
  if (cleanupHandle) return;

  const intervalMs = Math.max(1, intervalHours) * HOURS_TO_MS;
  const tick = async () => {
    try {
      activeCleanupRun = runCleanupOnce({ cleanup, logger });
      await activeCleanupRun;
    } catch (err) {
      logger.warn('[cleanup] scheduled cleanup failed:', err);
    } finally {
      activeCleanupRun = null;
    }
  };

  if (runImmediately) void tick();

  cleanupHandle = setInterval(tick, intervalMs);
  cleanupHandle.unref?.();

  logger.log(`[cleanup] scheduler started; interval=${intervalHours}h`);
}

export function stopCleanupScheduler(options: { wait?: false }): void;
export function stopCleanupScheduler(options: { wait: true }): Promise<void>;
export function stopCleanupScheduler(options: { wait?: boolean } = {}): Promise<void> | void {
  if (cleanupHandle) {
    clearInterval(cleanupHandle);
    cleanupHandle = null;
  }

  if (options.wait) {
    return activeCleanupRun?.then(() => undefined) ?? Promise.resolve();
  }
}
