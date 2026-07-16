// src/schedulers/bump_scheduler.ts
import { Client } from 'discord.js';
import {
  ThreadBumpService,
  isIndeterminateThreadBumpSendError,
  isTerminalThreadError,
} from '../services/thread_bump.service';
import { PerThreadBumpManager } from './per_thread_bump_manager';

let manager: PerThreadBumpManager | null = null;
let pollHandle: NodeJS.Timeout | null = null;

export interface BumpSchedulerController {
  stopAcceptingWork(): void;
  drain(timeoutMs: number): Promise<boolean>;
}

const controller: BumpSchedulerController = {
  stopAcceptingWork: stopBumpScheduler,
  async drain(timeoutMs: number): Promise<boolean> {
    return manager ? manager.drain(timeoutMs) : true;
  },
};

export function startBumpScheduler(client: Client): BumpSchedulerController {
  if (manager) return controller;
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
            // 🔎 DEBUG: why is this considered overdue?
            if (process.env.DEBUG_BUMP === '1') {
              console.debug(
                `[bump-debug] overdue thread=${r.thread_id} now=${new Date(now).toISOString()} ` +
                  `nextDue=${nextDue.toISOString()} last_bumped_at=${r.last_bumped_at?.toISOString() ?? 'null'} `,
              );
            }
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
          if (isIndeterminateThreadBumpSendError(e)) {
            await manager?.onRegisteredOrUpdated(r.thread_id);
            pollerCooldown.delete(r.thread_id);
          } else if (isTerminalThreadError(e)) {
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

  return controller;
}

export function stopBumpScheduler(): void {
  manager?.stop();
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = null;
}

export async function rescheduleThread(threadId: string): Promise<void> {
  if (!manager) return;
  await manager.onRegisteredOrUpdated(threadId);
}
export function unscheduleThread(threadId: string): void {
  manager?.onUnregistered(threadId);
}
