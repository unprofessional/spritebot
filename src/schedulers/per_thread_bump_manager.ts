// src/schedulers/per_thread_bump_manager.ts
import { Client } from 'discord.js';
import { ThreadBumpService } from '../services/thread_bump.service';
import type { BumpThreadRow } from '../dao/thread_bump.dao';

type TimerHandle = NodeJS.Timeout;

export class PerThreadBumpManager {
  private client: Client;
  private service = new ThreadBumpService();
  private timers = new Map<string, TimerHandle>(); // thread_id -> timeout

  // --- simple bump send queue to smooth bursts ---
  private inFlight = 0;
  private queue: Array<() => Promise<void>> = [];
  private readonly MAX_CONCURRENCY = 3;

  constructor(client: Client) {
    this.client = client;
  }

  async initialize(): Promise<void> {
    // Load all registered threads and schedule each
    const all = await this.service['dao'].findAll(); // or expose a service method if you prefer
    const now = Date.now();

    for (const row of all) {
      try {
        await this.scheduleForRow(row, now);
      } catch (err) {
        console.warn(`⚠️ Failed to schedule thread ${row.thread_id}:`, err);
      }
    }

    console.log(`🧭 Per-thread bump timers initialized for ${all.length} thread(s).`);
  }

  async onRegisteredOrUpdated(threadId: string): Promise<void> {
    // Clear any existing timer and reschedule based on fresh DB row
    this.clearTimer(threadId);

    const row = await this.service['dao'].get(threadId);
    if (!row) return;

    await this.scheduleForRow(row, Date.now());
  }

  onUnregistered(threadId: string): void {
    this.clearTimer(threadId);
  }

  stop(): void {
    for (const [, t] of this.timers) clearTimeout(t);
    this.timers.clear();
    // allow any in-flight queue items to finish naturally
  }

  // ---- internals ----

  private clearTimer(threadId: string) {
    const t = this.timers.get(threadId);
    if (t) clearTimeout(t);
    this.timers.delete(threadId);
  }

  private async scheduleForRow(row: BumpThreadRow, nowMs: number) {
    const due = this.service.nextDueAt(row).getTime();
    const delay = Math.max(0, due - nowMs);

    if (delay === 0) {
      // overdue: bump immediately once, then schedule to next interval
      try {
        await this.enqueueBump(() => this.service.bumpNow(this.client, row.thread_id));
      } catch (err) {
        console.warn(`⚠️ Failed immediate bump for ${row.thread_id}:`, err);
      }
      // re-fetch to recalc next due (last_bumped_at just changed)
      const fresh = await this.service['dao'].get(row.thread_id);
      if (!fresh) return;
      this.armOneShot(fresh);
    } else {
      this.armOneShot(row, delay);
    }
  }

  private armOneShot(row: BumpThreadRow, delayMs?: number) {
    const baseDelay = delayMs ?? Math.max(0, this.service.nextDueAt(row).getTime() - Date.now());

    const handle = setTimeout(async () => {
      try {
        await this.enqueueBump(() => this.service.bumpNow(this.client, row.thread_id));
      } catch (err) {
        console.warn(`⚠️ Bump failed for ${row.thread_id}:`, err);
      } finally {
        // Always re-arm for the next window (interval_minutes)
        const fresh = await this.service['dao'].get(row.thread_id);
        if (fresh) this.armOneShot(fresh);
      }
    }, withJitter(baseDelay));

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
          throw e; // still propagate to queue error log
        }
      });
      // kick the drain loop (non-blocking)
      void this.drainQueue();
    });
  }

  private async drainQueue(): Promise<void> {
    while (this.inFlight < this.MAX_CONCURRENCY && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;
      this.inFlight++;
      // run without blocking the loop; errors are logged below
      job()
        .catch((err) => {
          console.warn('⚠️ Queue job failed:', err);
        })
        .finally(() => {
          this.inFlight--;
          // continue draining if more work remains
          void this.drainQueue();
        });
    }
  }
}

// ~±15s jitter to avoid synchronized spikes
function withJitter(ms: number, rangeMs = 15000): number {
  const j = Math.floor(Math.random() * (2 * rangeMs + 1)) - rangeMs; // [-range, +range]
  return Math.max(0, ms + j);
}
