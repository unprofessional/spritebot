// src/schedulers/per_thread_bump_manager.ts
import { Client } from 'discord.js';
import { ThreadBumpService } from '../services/thread_bump.service';
import type { BumpThreadRow } from '../dao/thread_bump.dao';

type TimerHandle = NodeJS.Timeout;

export class PerThreadBumpManager {
  private client: Client;
  private service = new ThreadBumpService();
  private timers = new Map<string, TimerHandle>(); // thread_id -> timeout

  // --- bump send queue to smooth bursts ---
  private inFlight = 0;
  private queue: Array<() => Promise<void>> = [];
  private readonly MAX_CONCURRENCY = 3;

  constructor(client: Client) {
    this.client = client;
  }

  async initialize(): Promise<void> {
    const all = await this.service['dao'].findAll(); // or expose via service if you prefer
    const now = Date.now();

    console.log(`[bump] init: scheduling ${all.length} thread(s)`);

    for (const row of all) {
      try {
        await this.scheduleForRow(row, now);
      } catch (err) {
        console.warn(`⚠️ [bump] init schedule failed thread=${row.thread_id}:`, err);
      }
    }
  }

  async onRegisteredOrUpdated(threadId: string): Promise<void> {
    // Clear any existing timer and reschedule based on fresh DB row
    this.clearTimer(threadId);

    const row = await this.service['dao'].get(threadId);
    if (!row) {
      console.log(`[bump] reschedule: row missing thread=${threadId}`);
      return;
    }

    await this.scheduleForRow(row, Date.now());
  }

  onUnregistered(threadId: string): void {
    this.clearTimer(threadId);
    console.log(`[bump] unschedule thread=${threadId}`);
  }

  stop(): void {
    for (const [id, t] of this.timers) {
      clearTimeout(t);
      this.timers.delete(id);
    }
    // allow in‑flight queue items to finish naturally
    console.log('[bump] manager stopped; timers cleared');
  }

  // ---- internals ----

  private clearTimer(threadId: string) {
    const t = this.timers.get(threadId);
    if (t) clearTimeout(t);
    this.timers.delete(threadId);
  }

  private async scheduleForRow(row: BumpThreadRow, nowMs: number) {
    const dueMs = this.service.nextDueAt(row).getTime();
    const delay = Math.max(0, dueMs - nowMs);
    const dueIso = new Date(dueMs).toISOString();

    console.log(
      `[bump] schedule thread=${row.thread_id} due=${dueIso} delay=${Math.round(delay / 1000)}s`,
    );

    if (delay === 0) {
      // overdue: bump immediately once, then schedule forward
      console.log(`[bump] overdue -> immediate bump thread=${row.thread_id}`);
      try {
        await this.enqueueBump(() => this.service.bumpNow(this.client, row.thread_id));
        console.log(`[bump] immediate bump OK thread=${row.thread_id}`);
      } catch (err) {
        console.warn(`⚠️ [bump] immediate bump failed thread=${row.thread_id}:`, err);
      }
      // re-fetch to recalc next due (last_bumped_at just changed if send succeeded)
      const fresh = await this.service['dao'].get(row.thread_id);
      if (!fresh) return;
      this.armOneShot(fresh);
    } else {
      this.armOneShot(row, delay);
    }
  }

  private armOneShot(row: BumpThreadRow, delayMs?: number) {
    const baseDelay = delayMs ?? Math.max(0, this.service.nextDueAt(row).getTime() - Date.now());
    const jittered = withJitter(baseDelay);

    console.log(
      `[bump] arm thread=${row.thread_id} in ${Math.round(jittered / 1000)}s (base=${Math.round(baseDelay / 1000)}s)`,
    );

    const handle = setTimeout(async () => {
      console.log(`[bump] fire thread=${row.thread_id}`);
      try {
        await this.enqueueBump(() => this.service.bumpNow(this.client, row.thread_id));
        console.log(`[bump] fired OK thread=${row.thread_id}`);
      } catch (err) {
        console.warn(`⚠️ [bump] fire failed thread=${row.thread_id}:`, err);
      } finally {
        // Always re‑arm for the next window
        const fresh = await this.service['dao'].get(row.thread_id);
        if (fresh) {
          this.armOneShot(fresh);
        } else {
          // row deleted since we scheduled; ensure timer state is clean
          this.clearTimer(row.thread_id);
        }
      }
    }, jittered);

    // store/replace handle
    this.clearTimer(row.thread_id);
    this.timers.set(row.thread_id, handle);
  }

  // --- tiny send queue ---

  private async enqueueBump(task: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await task();
          resolve();
        } catch (e) {
          reject(e);
          throw e; // still bubble for logging in caller
        }
      });
      // kick the drain loop (non‑blocking)
      void this.drainQueue();
    });
  }

  private async drainQueue(): Promise<void> {
    while (this.inFlight < this.MAX_CONCURRENCY && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;
      this.inFlight++;
      job()
        .catch((err) => {
          console.warn('⚠️ [bump] queue job failed:', err);
        })
        .finally(() => {
          this.inFlight--;
          // continue draining if more work remains
          if (this.queue.length > 0) void this.drainQueue();
        });
    }
  }
}

// ~±15s jitter to avoid synchronized spikes
function withJitter(ms: number, rangeMs = 15000): number {
  const j = Math.floor(Math.random() * (2 * rangeMs + 1)) - rangeMs; // [-range, +range]
  return Math.max(0, ms + j);
}
