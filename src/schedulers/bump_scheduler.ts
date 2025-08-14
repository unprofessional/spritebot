// src/schedulers/bump_scheduler.ts
import { Client } from 'discord.js';
import { PerThreadBumpManager } from './per_thread_bump_manager';

let manager: PerThreadBumpManager | null = null;

export function startBumpScheduler(client: Client): void {
  if (manager) return; // guard
  manager = new PerThreadBumpManager(client);

  void manager.initialize();

  const stop = () => {
    manager?.stop();
    manager = null;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

// Optional helper so commands can notify the scheduler to reschedule a single thread after changes
export async function rescheduleThread(threadId: string): Promise<void> {
  if (!manager) return;
  await manager.onRegisteredOrUpdated(threadId);
}
export function unscheduleThread(threadId: string): void {
  manager?.onUnregistered(threadId);
}
