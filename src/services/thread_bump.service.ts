// src/services/thread_bump.service.ts
import {
  Channel,
  Client,
  Collection,
  PermissionFlagsBits,
  ThreadChannel,
  type Message,
  type MessageCreateOptions,
  type MessageMentionTypes,
} from 'discord.js';
import { bumpDefaultMinutes, bumpBufferMinutes } from '../config/env_config';
import { ThreadBumpDAO, type BumpThreadRow } from '../dao/thread_bump.dao';
import { defineDiscordOperationPolicy } from '../discord/operation_policy';
import { executeDiscordSdkMethod, executeDiscordSdkMethodAs } from '../discord/sdk_operations';
import { DiscordOperationError } from '../discord/operation_executor';

const NO_MENTIONS: ReadonlyArray<MessageMentionTypes> = [];
const threadChannelReadPolicy = defineDiscordOperationPolicy({
  operation: 'thread-bump.fetch-channel',
  timeoutMs: 1_500,
  totalBudgetMs: 4_000,
  retry: 'safe-read',
  maxAttempts: 2,
});
const threadMessageReadPolicy = defineDiscordOperationPolicy({
  operation: 'thread-bump.fetch-latest-message',
  timeoutMs: 1_500,
  totalBudgetMs: 4_000,
  retry: 'safe-read',
  maxAttempts: 2,
});
const threadArchiveWritePolicy = defineDiscordOperationPolicy({
  operation: 'thread-bump.set-archived',
  timeoutMs: 2_000,
  totalBudgetMs: 5_000,
  retry: 'idempotent-write',
  maxAttempts: 2,
});
const threadLockWritePolicy = defineDiscordOperationPolicy({
  operation: 'thread-bump.set-locked',
  timeoutMs: 2_000,
  totalBudgetMs: 5_000,
  retry: 'idempotent-write',
  maxAttempts: 2,
});
const threadSendPolicy = defineDiscordOperationPolicy({
  operation: 'thread-bump.send',
  timeoutMs: 3_000,
  totalBudgetMs: 3_000,
});
const threadDeletePolicy = defineDiscordOperationPolicy({
  operation: 'thread-bump.delete-message',
  timeoutMs: 2_000,
  totalBudgetMs: 2_000,
});

// === utils ===
const DISCORD_EPOCH = 1420070400000n; // 2015-01-01T00:00:00.000Z

function snowflakeToDate(id: string): Date {
  // Discord snowflake timestamp: (id >> 22) + DISCORD_EPOCH
  const ts = Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
  return new Date(ts);
}

function buildBumpMessage(note?: string | null): MessageCreateOptions {
  return {
    content: `🔄 **Thread auto-bumped to keep it active.**${note ? `\n💬 _${note}_` : ''}`,
    allowedMentions: {
      parse: NO_MENTIONS, // no @everyone/@here/roles/users
      users: [],
      roles: [],
      repliedUser: false,
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

/**
 * Interval-only next due (legacy / sync path).
 * Kept for backward compatibility where callers haven't been updated to archive-aware scheduling.
 */
function nextDueAtIntervalOnly(row: BumpThreadRow): Date {
  const base = row.last_bumped_at ?? row.created_at ?? new Date();
  const due = new Date(base);
  const minutes = row.interval_minutes ?? bumpDefaultMinutes;
  due.setMinutes(due.getMinutes() + minutes);
  return due;
}

/**
 * Lightweight meta for archive-aware scheduling.
 */
async function getThreadMeta(
  client: Client,
  threadId: string,
): Promise<{ autoArchiveMinutes: number | null; lastActivityAt: Date | null }> {
  const chan = await executeDiscordSdkMethodAs<Channel | null>(
    threadChannelReadPolicy,
    client.channels,
    'fetch',
    threadId,
  ).catch(() => null);
  const thread = asThread(chan);
  if (!thread) return { autoArchiveMinutes: null, lastActivityAt: null };

  // last activity from lastMessageId (fast, no extra HTTP); fallback to fetching 1 message
  let lastActivityAt: Date | null = null;
  if (thread.lastMessageId) {
    lastActivityAt = snowflakeToDate(thread.lastMessageId);
  } else {
    try {
      const msgs = await executeDiscordSdkMethodAs<Collection<string, Message>>(
        threadMessageReadPolicy,
        thread.messages,
        'fetch',
        { limit: 1 },
      );
      const m = msgs.first();
      if (m?.createdTimestamp) lastActivityAt = new Date(m.createdTimestamp);
    } catch {
      // ignore – we'll fall back to DB timestamps
    }
  }

  const autoArchiveMinutes =
    typeof thread.autoArchiveDuration === 'number' ? thread.autoArchiveDuration : null;

  return { autoArchiveMinutes, lastActivityAt };
}

async function ensureWritable(thread: ThreadChannel): Promise<void> {
  const me = thread.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.SendMessagesInThreads)) {
    throw new Error('Bot lacks SendMessagesInThreads permission.');
  }
  if (thread.archived) {
    try {
      await executeDiscordSdkMethod(threadArchiveWritePolicy, thread, 'setArchived', false);
    } catch (e) {
      throw new Error(`Cannot unarchive thread (need ManageThreads?): ${String(e)}`);
    }
  }
  if (thread.locked) {
    try {
      await executeDiscordSdkMethod(threadLockWritePolicy, thread, 'setLocked', false);
    } catch {
      /* non-fatal */
    }
  }
}

type BumpOptions = {
  /** delete the bump message right after sending (default: true) */
  deleteAfter?: boolean;
  /** optional small delay before deleting, in ms (default: 0) */
  deleteDelayMs?: number;
};

export class ThreadBumpService {
  private dao = new ThreadBumpDAO();

  /**
   * Sends a bump message to the thread.
   * By default, deletes the message right after sending (keeps thread clean) but still resets activity.
   * Pass { deleteAfter: false } to keep the bump visible (e.g., for manual tests).
   */
  async bumpNow(client: Client, threadId: string, opts?: BumpOptions): Promise<void> {
    const deleteAfter = opts?.deleteAfter !== false; // default true
    const deleteDelayMs = Math.max(0, opts?.deleteDelayMs ?? 0);

    const chan = await executeDiscordSdkMethodAs<Channel | null>(
      threadChannelReadPolicy,
      client.channels,
      'fetch',
      threadId,
    ).catch(() => null);
    const thread = asThread(chan);
    if (!thread) throw new Error('Not a thread channel or cannot fetch thread.');

    await ensureWritable(thread);

    const row = await this.dao.get(threadId);
    const note = row?.note ?? null;

    // 1) Send and await ack from Discord (this updates thread activity)
    let sent: Message;
    try {
      sent = await executeDiscordSdkMethod(
        threadSendPolicy,
        thread,
        'send',
        buildBumpMessage(note),
      );
    } catch (error) {
      if (!isIndeterminateSendFailure(error)) throw error;

      // Discord may have accepted the message before the connection failed. Advance the schedule
      // without retrying the send, then let callers report the indeterminate result.
      await this.dao.touchLastBumped(threadId, new Date());
      throw new IndeterminateThreadBumpSendError(error);
    }

    // 2) Update DB regardless of deletion outcome
    await this.dao.touchLastBumped(threadId, new Date());
    // 3) Optionally delete to keep thread clean. Never retry sends or deletes: a timeout leaves the
    // result indeterminate, and retrying could duplicate the bump or race a successful deletion.
    if (deleteAfter) {
      try {
        // Keep it visible briefly so Discord's lastMessageId advances during propagation.
        await new Promise((r) => setTimeout(r, 3_000));
        if (deleteDelayMs > 0) {
          await new Promise((r) => setTimeout(r, deleteDelayMs));
        }
        await executeDiscordSdkMethod(threadDeletePolicy, sent, 'delete');
      } catch (e) {
        // Not fatal: the bump already reset activity and DB was updated
        // Common causes: missing perms to delete, message already deleted by mods, etc.
        console.warn(`⚠️ Failed to delete bump message in ${threadId}:`, e);
      }
    }
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

  /**
   * Archive-aware next-due:
   * - Always compute the interval due.
   * - If we can derive (last activity + autoArchive - GUARD), take the EARLIER of the two.
   * This guarantees we bump *before* archive across all lifespans (60/1440/4320/10080).
   */
  async nextDueAt(client: Client, row: BumpThreadRow): Promise<Date> {
    // 1) Always compute the interval due (fallback & upper bound)
    const intervalDue = nextDueAtIntervalOnly(row);

    try {
      const { autoArchiveMinutes, lastActivityAt } = await getThreadMeta(client, row.thread_id);

      // 👇 NEW: prefer the freshest known activity – DB bump time wins if newer.
      // If last_bumped_at is newer than Discord’s visible last message (which can
      // roll back after we delete the bump), we must honor last_bumped_at.
      const freshestActivity =
        row.last_bumped_at && (!lastActivityAt || row.last_bumped_at > lastActivityAt)
          ? row.last_bumped_at
          : lastActivityAt;

      if (autoArchiveMinutes && freshestActivity) {
        // schedule GUARD minutes before archive
        const guard = Math.max(1, bumpBufferMinutes | 0);
        const effective = Math.max(1, autoArchiveMinutes - guard);

        const archiveDue = new Date(freshestActivity);
        archiveDue.setMinutes(archiveDue.getMinutes() + effective);

        // Earliest wins: we want to fire before either boundary
        return archiveDue < intervalDue ? archiveDue : intervalDue;
      }
    } catch {
      // ignore meta errors; fall through to intervalDue
    }

    return intervalDue;
  }

  /**
   * Legacy sync helper (interval-only) to keep older callers compiling.
   * Prefer the archive-aware async `nextDueAt(client, row)` everywhere else.
   */
  nextDueAtSync(row: BumpThreadRow): Date {
    return nextDueAtIntervalOnly(row);
  }
}

function isTerminalThreadError(err: unknown): boolean {
  if (
    err instanceof DiscordOperationError &&
    (err.classified.category === 'authentication_or_permission' ||
      err.classified.category === 'not_found')
  ) {
    return true;
  }
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message ?? '')
        : '';
  // Typical cases when a thread is gone / inaccessible
  return /Unknown Channel|Missing Access|Not a thread channel|cannot fetch thread|Cannot unarchive thread/i.test(
    msg,
  );
}

class IndeterminateThreadBumpSendError extends Error {
  constructor(cause: unknown) {
    super('Thread bump send result was indeterminate; the send will not be retried.', { cause });
    this.name = 'IndeterminateThreadBumpSendError';
  }
}

function isIndeterminateSendFailure(error: unknown): boolean {
  return (
    error instanceof DiscordOperationError &&
    (error.classified.category === 'timeout' || error.classified.category === 'transient_network')
  );
}

function isIndeterminateThreadBumpSendError(
  error: unknown,
): error is IndeterminateThreadBumpSendError {
  return error instanceof IndeterminateThreadBumpSendError;
}

export { isIndeterminateThreadBumpSendError, isTerminalThreadError };
