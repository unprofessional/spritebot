// src/schedulers/bump_scheduler.ts
import { Client } from 'discord.js';
import { ThreadBumpService, isTerminalThreadError } from '../services/thread_bump.service';
import { PerThreadBumpManager } from './per_thread_bump_manager';

let manager: PerThreadBumpManager | null = null;
let pollHandle: NodeJS.Timeout | null = null;

export function startBumpScheduler(client: Client): void {
  if (manager) return;
  manager = new PerThreadBumpManager(client);
  void manager.initialize();

  // DB backstop: check due items every 30s
  const service = new ThreadBumpService();

  const pollerCooldown = new Map<string, number>(); // thread_id -> resumeEpochMs
  const POLLER_COOLDOWN_MS = 5 * 60_000; // 5 minutes

  pollHandle = setInterval(async () => {
    try {
      const rows = await service['dao'].findAll();
      const now = Date.now();

      // ARCHIVE-AWARE: compute due using async nextDueAt(client, row)
      const due: typeof rows = [];
      for (const r of rows) {
        const until = pollerCooldown.get(r.thread_id) ?? 0;
        if (until > now) continue;

        try {
          const nextDue = await service.nextDueAt(client, r);
          if (nextDue.getTime() <= now) {
            due.push(r);
          }
        } catch {
          // If next due can't be computed this cycle, skip and try again next tick
        }
      }

      if (due.length) {
        console.log(`[bump-poller] found ${due.length} overdue`);
      }

      for (const r of due) {
        try {
          await service.bumpNow(client, r.thread_id);
          await manager?.onRegisteredOrUpdated(r.thread_id); // re-arm archive-aware timer
          pollerCooldown.delete(r.thread_id);
        } catch (e) {
          console.warn(`⚠️ poller bump failed ${r.thread_id}:`, e);
          if (isTerminalThreadError(e)) {
            await service['dao'].delete(r.thread_id).catch(() => {});
            manager?.onUnregistered(r.thread_id);
            pollerCooldown.delete(r.thread_id);
          } else {
            pollerCooldown.set(r.thread_id, Date.now() + POLLER_COOLDOWN_MS);
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ bump poller error:', e);
    }
  }, 30_000);

  const stop = () => {
    manager?.stop();
    manager = null;
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = null;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

export async function rescheduleThread(threadId: string): Promise<void> {
  if (!manager) return;
  await manager.onRegisteredOrUpdated(threadId);
}
export function unscheduleThread(threadId: string): void {
  manager?.onUnregistered(threadId);
}
