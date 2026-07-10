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
  registerSignals?: boolean;
}

let cleanupHandle: NodeJS.Timeout | null = null;

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
  registerSignals = true,
}: SchedulerOptions = {}): void {
  if (cleanupHandle) return;

  const intervalMs = Math.max(1, intervalHours) * HOURS_TO_MS;
  const tick = async () => {
    try {
      await runCleanupOnce({ cleanup, logger });
    } catch (err) {
      logger.warn('[cleanup] scheduled cleanup failed:', err);
    }
  };

  if (runImmediately) void tick();

  cleanupHandle = setInterval(tick, intervalMs);
  cleanupHandle.unref?.();

  if (registerSignals) {
    process.once('SIGINT', stopCleanupScheduler);
    process.once('SIGTERM', stopCleanupScheduler);
  }

  logger.log(`[cleanup] scheduler started; interval=${intervalHours}h`);
}

export function stopCleanupScheduler(): void {
  if (!cleanupHandle) return;
  clearInterval(cleanupHandle);
  cleanupHandle = null;
}
