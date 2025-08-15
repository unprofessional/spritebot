// src/services/thread_bump.service.ts
import {
  Client,
  ThreadChannel,
  Channel,
  PermissionFlagsBits,
  type MessageCreateOptions,
  type MessageMentionTypes,
} from 'discord.js';
import { ThreadBumpDAO, type BumpThreadRow } from '../dao/thread_bump.dao';

const NO_MENTIONS: ReadonlyArray<MessageMentionTypes> = [];

function buildBumpMessage(note?: string | null): MessageCreateOptions {
  return {
    content: `🔄 **Thread auto-bumped to keep it active.**${note ? `\n💬 _${note}_` : ''}`,
    allowedMentions: {
      parse: NO_MENTIONS, // ✅ readonly MessageMentionTypes[]
      users: [], // extra hardening (no user pings)
      roles: [], // no role pings
      repliedUser: false, // don't ping the author on replies
    },
  };
}

function asThread(channel: Channel | null): ThreadChannel | null {
  if (
    channel &&
    'isThread' in channel &&
    typeof (channel as ThreadChannel).isThread === 'function' &&
    (channel as ThreadChannel).isThread()
  ) {
    return channel as ThreadChannel;
  }
  return null;
}

function nextDueAt(row: BumpThreadRow): Date {
  const base = row.last_bumped_at ?? row.created_at ?? new Date();
  const due = new Date(base);
  due.setMinutes(due.getMinutes() + (row.interval_minutes ?? 10080));
  return due;
}

async function ensureWritable(thread: ThreadChannel): Promise<void> {
  const me = thread.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.SendMessagesInThreads)) {
    throw new Error('Bot lacks SendMessagesInThreads permission.');
  }
  if (thread.archived) {
    try {
      await thread.setArchived(false);
    } catch (e) {
      throw new Error(`Cannot unarchive thread (need ManageThreads?): ${String(e)}`);
    }
  }
  if (thread.locked) {
    try {
      await thread.setLocked(false);
    } catch {
      /* non-fatal */
    }
  }
}

export class ThreadBumpService {
  private dao = new ThreadBumpDAO();

  async bumpNow(client: Client, threadId: string): Promise<void> {
    const chan = await client.channels.fetch(threadId).catch(() => null);
    const thread = asThread(chan);
    if (!thread) throw new Error('Not a thread channel or cannot fetch thread.');

    await ensureWritable(thread);

    const row = await this.dao.get(threadId);
    const note = row?.note ?? null;

    await thread.send(buildBumpMessage(note)); // ✅ MessageCreateOptions
    await this.dao.touchLastBumped(threadId, new Date());
  }

  async register(
    threadId: string,
    guildId: string,
    addedBy: string,
    note?: string | null,
    intervalMinutes?: number,
  ): Promise<void> {
    await this.dao.insert({
      thread_id: threadId,
      guild_id: guildId,
      added_by: addedBy,
      note: note ?? null,
      interval_minutes: intervalMinutes,
    });
  }

  async unregister(threadId: string): Promise<boolean> {
    return this.dao.delete(threadId);
  }

  async setNote(threadId: string, note: string | null): Promise<boolean> {
    return this.dao.updateNote(threadId, note);
  }

  async setInterval(threadId: string, intervalMinutes: number): Promise<boolean> {
    return this.dao.updateInterval(threadId, intervalMinutes);
  }

  async listGuild(guildId: string) {
    return this.dao.listByGuild(guildId);
  }

  async isRegistered(threadId: string) {
    return this.dao.exists(threadId);
  }

  nextDueAt(row: BumpThreadRow): Date {
    return nextDueAt(row);
  }
}
