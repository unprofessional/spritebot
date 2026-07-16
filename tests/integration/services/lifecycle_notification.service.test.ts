import { LifecycleNotificationChannelDAO } from '../../../src/dao/lifecycle_notification_channel.dao';

const lifecycleNotificationChannelDAO = new LifecycleNotificationChannelDAO();

describe('lifecycle_notification.service', () => {
  test('sends lifecycle notifications to all registered channels', async () => {
    process.env.LIFECYCLE_NOTIFY_GUILD_ID = '';
    process.env.LIFECYCLE_NOTIFY_CHANNEL_ID = '';

    const { sendLifecycleNotification } =
      require('../../../src/services/lifecycle_notification.service') as {
        sendLifecycleNotification(
          client: unknown,
          event: 'online' | 'shutdown',
        ): Promise<{
          sent: number;
          failed: number;
          skipped: number;
        }>;
      };

    await lifecycleNotificationChannelDAO.upsert({
      guildId: 'guild-1',
      channelId: 'channel-1',
      updatedBy: 'admin-1',
    });
    await lifecycleNotificationChannelDAO.upsert({
      guildId: 'guild-2',
      channelId: 'channel-2',
      updatedBy: 'admin-2',
    });

    const sendOne = jest.fn().mockResolvedValue(undefined);
    const sendTwo = jest.fn().mockResolvedValue(undefined);
    const channels = new Map([
      ['guild-1:channel-1', { isTextBased: () => true, send: sendOne }],
      ['guild-2:channel-2', { isTextBased: () => true, send: sendTwo }],
    ]);
    const client = {
      guilds: {
        fetch: jest.fn(async (guildId: string) => ({
          channels: {
            fetch: jest.fn(async (channelId: string) => channels.get(`${guildId}:${channelId}`)),
          },
        })),
      },
    };

    await expect(sendLifecycleNotification(client, 'online')).resolves.toEqual({
      sent: 2,
      failed: 0,
      skipped: 0,
    });

    expect(sendOne).toHaveBeenCalledWith({
      content: '✅ **Spritebot status:** Spritebot is back online.',
      allowedMentions: { parse: [] },
    });
    expect(sendTwo).toHaveBeenCalledWith({
      content: '✅ **Spritebot status:** Spritebot is back online.',
      allowedMentions: { parse: [] },
    });
  });

  test('does not retry a lifecycle notification send after an indeterminate failure', async () => {
    process.env.LIFECYCLE_NOTIFY_GUILD_ID = '';
    process.env.LIFECYCLE_NOTIFY_CHANNEL_ID = '';
    const { sendLifecycleNotification } =
      require('../../../src/services/lifecycle_notification.service') as {
        sendLifecycleNotification(
          client: unknown,
          event: 'online',
        ): Promise<{
          sent: number;
          failed: number;
          skipped: number;
        }>;
      };
    await lifecycleNotificationChannelDAO.upsert({
      guildId: 'guild-failure',
      channelId: 'channel-failure',
      updatedBy: 'admin-1',
    });
    const send = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
    const client = {
      guilds: {
        fetch: jest.fn().mockResolvedValue({
          channels: {
            fetch: jest.fn().mockResolvedValue({ isTextBased: () => true, send }),
          },
        }),
      },
    };

    await expect(sendLifecycleNotification(client, 'online')).resolves.toEqual({
      sent: 0,
      failed: 1,
      skipped: 0,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
