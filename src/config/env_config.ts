// src/config/env_config.ts
import dotenv from 'dotenv';
dotenv.config({ quiet: process.env.NODE_ENV === 'test' });

export const token = process.env.DISCORD_BOT_TOKEN ?? '';
export const runMode = process.env.RUN_MODE ?? 'development';

export const pgHost = process.env.PG_HOST ?? '';
export const pgPort = process.env.PG_PORT ?? '';
export const pgUser = process.env.PG_USER ?? '';
export const pgPass = process.env.PG_PASS ?? '';
export const pgDb = process.env.PG_DB ?? '';

export const lifecycleNotifyGuildId = process.env.LIFECYCLE_NOTIFY_GUILD_ID ?? '';
export const lifecycleNotifyChannelId = process.env.LIFECYCLE_NOTIFY_CHANNEL_ID ?? '';

/** Bump config (minutes) */
const toInt = (v: string | undefined, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
};
const toMs = (v: string | undefined, dfltMs: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dfltMs;
};

export const transcriptionServiceUrl =
  process.env.TRANSCRIPTION_SERVICE_URL ?? 'http://192.168.7.73:9700/inference';
export const transcriptionSilenceMs = toMs(process.env.TRANSCRIPTION_SILENCE_MS, 700);
export const transcriptionMaxSegmentMs = toMs(process.env.TRANSCRIPTION_MAX_SEGMENT_MS, 30_000);
export const transcriptionMinSegmentMs = toMs(process.env.TRANSCRIPTION_MIN_SEGMENT_MS, 600);
export const transcriptionVadThreshold = Number(process.env.TRANSCRIPTION_VAD_THRESHOLD ?? '0.012');

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

// Housekeeping cleanup scheduler. Defaults to once per day.
export const cleanupIntervalHours = toInt(process.env.CLEANUP_INTERVAL_HOURS, 24);
