import type { Client } from 'discord.js';

import { lifecycleNotifyChannelId, lifecycleNotifyGuildId } from '../config/env_config';
import { LifecycleNotificationChannelDAO } from '../dao/lifecycle_notification_channel.dao';

type LifecycleEvent = 'online' | 'shutdown';
type NotificationTarget = { guildId: string; channelId: string; source: 'db' | 'env' };
type NotificationSummary = { sent: number; failed: number; skipped: number };

const lifecycleNotificationChannelDAO = new LifecycleNotificationChannelDAO();

const EVENT_COPY: Record<LifecycleEvent, { marker: string; text: string }> = {
  online: {
    marker: '✅',
    text: 'Spritebot is back online.',
  },
  shutdown: {
    marker: '⚠️',
    text: 'Spritebot is shutting down or restarting.',
  },
};

function envTarget(): NotificationTarget | null {
  if (!lifecycleNotifyGuildId || !lifecycleNotifyChannelId) return null;

  return {
    guildId: lifecycleNotifyGuildId,
    channelId: lifecycleNotifyChannelId,
    source: 'env',
  };
}

async function getNotificationTargets(): Promise<NotificationTarget[]> {
  const rows = await lifecycleNotificationChannelDAO.findAll();
  const targets: NotificationTarget[] = rows.map((row) => ({
    guildId: row.guild_id,
    channelId: row.channel_id,
    source: 'db',
  }));

  const fallback = envTarget();
  if (fallback) targets.push(fallback);

  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.guildId}:${target.channelId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function sendLifecycleNotification(
  client: Client,
  event: LifecycleEvent,
): Promise<NotificationSummary> {
  const targets = await getNotificationTargets();
  if (!targets.length) return { sent: 0, failed: 0, skipped: 0 };

  const copy = EVENT_COPY[event];
  const content = `${copy.marker} **Spritebot status:** ${copy.text}`;

  console.log(`[lifecycle] Sending ${event} notification to ${targets.length} channel(s).`);

  const results = await Promise.all(
    targets.map(async (target): Promise<keyof NotificationSummary> => {
      try {
        const guild = await client.guilds.fetch(target.guildId);
        const channel = await guild.channels.fetch(target.channelId);

        if (!channel?.isTextBased() || !('send' in channel)) {
          console.warn(
            `[lifecycle] Notification channel ${target.channelId} in guild ${target.guildId} is not text-sendable.`,
          );
          return 'skipped';
        }

        await channel.send({
          content,
          allowedMentions: { parse: [] },
        });
        return 'sent';
      } catch (err) {
        console.warn(
          `[lifecycle] Failed to send ${event} notification to guild=${target.guildId} channel=${target.channelId} source=${target.source}:`,
          err,
        );
        return 'failed';
      }
    }),
  );

  return results.reduce<NotificationSummary>(
    (summary, result) => ({
      ...summary,
      [result]: summary[result] + 1,
    }),
    { sent: 0, failed: 0, skipped: 0 },
  );
}

export function installShutdownNotifications(client: Client): void {
  let shuttingDown = false;

  const handleSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    void (async () => {
      console.log(`[lifecycle] Received ${signal}; sending shutdown notification.`);
      await sendLifecycleNotification(client, 'shutdown');
      client.destroy();
      process.exit(0);
    })();
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
}
