import { Client } from 'discord.js';
import { bumpRegisteredThreads } from '../features/bump_thread_message';

export function startBumpScheduler(client: Client): void {
  // 7-day interval in ms
  const oneWeekMs = 1000 * 60 * 60 * 24 * 7;

  setInterval(() => {
    console.log('⏰ Running weekly thread bump...');
    void bumpRegisteredThreads(client);
  }, oneWeekMs);
}
