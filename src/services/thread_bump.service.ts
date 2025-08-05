import { Client, ThreadChannel } from 'discord.js';
import { ThreadBumpDAO } from '../dao/thread_bump.dao';

function buildBumpMessage(note?: string | null) {
  return {
    content: `🔄 **Thread auto-bumped to keep it active.**${note ? `\n💬 _${note}_` : ''}`,
    allowedMentions: { users: [] },
  };
}

export class ThreadBumpService {
  private dao = new ThreadBumpDAO();

  async runWeeklyBumps(client: Client): Promise<void> {
    const threads = await this.dao.findAll();

    for (const row of threads) {
      try {
        const thread = await client.channels.fetch(row.thread_id);

        if (!thread?.isThread()) continue;

        const msg = buildBumpMessage(row.note);
        await (thread as ThreadChannel).send(msg);
      } catch (err) {
        console.warn(`⚠️ Failed to bump thread ${row.thread_id}:`, err);
      }
    }
  }
}
