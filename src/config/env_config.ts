// src/config/env_config.ts
import dotenv from 'dotenv';
dotenv.config();

export const token = process.env.DISCORD_BOT_TOKEN ?? '';
export const runMode = process.env.RUN_MODE ?? 'development';

export const pgHost = process.env.PG_HOST ?? '';
export const pgPort = process.env.PG_PORT ?? '';
export const pgUser = process.env.PG_USER ?? '';
export const pgPass = process.env.PG_PASS ?? '';
export const pgDb = process.env.PG_DB ?? '';

/** Bump config (minutes) */
const toInt = (v: string | undefined, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
};
const toMs = (v: string | undefined, dfltMs: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dfltMs;
};

// Default weekly: 7d * 24h * 60m = 10080; safer default is 10050 (7d - 30m)
export const bumpDefaultMinutes = toInt(process.env.BUMP_DEFAULT_MINUTES, 10050);
/** Safety margin subtracted from thread.autoArchiveDuration when deriving default & next-due */
export const bumpBufferMinutes = toInt(process.env.BUMP_BUFFER_MINUTES, 30);
/** Smallest allowed interval */
export const bumpMinMinutes = toInt(process.env.BUMP_MIN_MINUTES, 10);
/** If true, use (autoArchiveDuration - buffer) when registering without explicit minutes */
export const bumpUseArchiveAwareDefault =
  (process.env.BUMP_ARCHIVE_AWARE_DEFAULT ?? 'true') === 'true';

// --- Optional runtime tuning (used by schedulers if you want) ---
export const bumpMinDelayMs = toMs(process.env.BUMP_MIN_DELAY_MS, 30_000);
export const bumpMaxRetryDelayMs = toMs(process.env.BUMP_MAX_RETRY_DELAY_MS, 15 * 60_000);
export const bumpJitterMs = toMs(process.env.BUMP_JITTER_MS, 15_000);
export const bumpPollIntervalMs = toMs(process.env.BUMP_POLLER_INTERVAL_MS, 30_000);
export const bumpPollerCooldownMs = toMs(process.env.BUMP_POLLER_COOLDOWN_MS, 5 * 60_000);
export const bumpMaxConcurrency = toInt(process.env.BUMP_MAX_CONCURRENCY, 3);
