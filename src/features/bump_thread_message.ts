// src/features/bump_thread_message.ts

import { Client } from 'discord.js';
import { ThreadBumpService } from '../services/thread_bump.service';

const service = new ThreadBumpService();

export async function bumpRegisteredThreads(client: Client): Promise<void> {
  await service.runWeeklyBumps(client);
}
