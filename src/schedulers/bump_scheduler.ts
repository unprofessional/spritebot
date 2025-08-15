// src/schedulers/bump_scheduler.ts
import { Client } from 'discord.js';
import { ThreadBumpService } from '../services/thread_bump.service';
import { PerThreadBumpManager } from './per_thread_bump_manager';

let manager: PerThreadBumpManager | null = null;
let pollHandle: NodeJS.Timeout | null = null;

export function startBumpScheduler(client: Client): void {
  if (manager) return;
  manager = new PerThreadBumpManager(client);
  void manager.initialize();

  // DB backstop: check due items every 30s
  const service = new ThreadBumpService();
  pollHandle = setInterval(async () => {
    try {
      const rows = await service['dao'].findAll(); // or add a dao method: listDue(NOW())
      const now = Date.now();
      const due = rows.filter((r) => service.nextDueAt(r).getTime() <= now);
      if (due.length) {
        console.log(`[bump-poller] found ${due.length} overdue`);
      }
      for (const r of due) {
        try {
          await service.bumpNow(client, r.thread_id);
          // re-arm that thread’s timer to the next window
          await manager?.onRegisteredOrUpdated(r.thread_id);
        } catch (e) {
          console.warn(`⚠️ poller bump failed ${r.thread_id}:`, e);
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
