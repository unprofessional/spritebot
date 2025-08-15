// src/config/bump_config.ts
import type { ThreadChannel } from 'discord.js';
import {
  bumpBufferMinutes,
  bumpDefaultMinutes,
  bumpMinMinutes,
  bumpUseArchiveAwareDefault,
} from './env_config';

/** Compute the default interval to store when user didn’t specify minutes */
export function computeDefaultIntervalMinutes(thread?: ThreadChannel | null): number {
  if (!bumpUseArchiveAwareDefault || !thread?.autoArchiveDuration) {
    return bumpDefaultMinutes;
  }
  // autoArchiveDuration is one of 60, 1440, 4320, 10080
  const derived = Math.max(bumpMinMinutes, thread.autoArchiveDuration - bumpBufferMinutes);
  // If derived is strangely small (e.g., 30), still accept but clamp by bumpMinMinutes above
  return derived;
}
