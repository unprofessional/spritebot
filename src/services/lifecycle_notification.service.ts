import type { Client } from 'discord.js';

import { lifecycleNotifyChannelId, lifecycleNotifyGuildId } from '../config/env_config';

type LifecycleEvent = 'online' | 'shutdown';

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

function isConfigured(): boolean {
  return Boolean(lifecycleNotifyGuildId && lifecycleNotifyChannelId);
}

export async function sendLifecycleNotification(
  client: Client,
  event: LifecycleEvent,
): Promise<boolean> {
  if (!isConfigured()) return false;

  const copy = EVENT_COPY[event];
  const content = `${copy.marker} **Spritebot status:** ${copy.text}`;

  try {
    const guild = await client.guilds.fetch(lifecycleNotifyGuildId);
    const channel = await guild.channels.fetch(lifecycleNotifyChannelId);

    if (!channel?.isTextBased() || !('send' in channel)) {
      console.warn(
        `[lifecycle] Notification channel ${lifecycleNotifyChannelId} is not text-sendable.`,
      );
      return false;
    }

    await channel.send({
      content,
      allowedMentions: { parse: [] },
    });
    return true;
  } catch (err) {
    console.warn(`[lifecycle] Failed to send ${event} notification:`, err);
    return false;
  }
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
