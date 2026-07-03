import { LifecycleNotificationChannelDAO } from '../../../src/dao/lifecycle_notification_channel.dao';

const command = require('../../../src/commands/bot-announcements') as {
  execute(interaction: unknown): Promise<void>;
};

const lifecycleNotificationChannelDAO = new LifecycleNotificationChannelDAO();

function createInteraction({
  guildId = 'guild-1',
  subcommand,
  channel = null,
}: {
  guildId?: string | null;
  subcommand: 'set' | 'clear' | 'status';
  channel?: { id: string; guildId: string; toString(): string } | null;
}) {
  const reply = jest.fn().mockResolvedValue(undefined);

  return {
    interaction: {
      guildId,
      user: { id: 'admin-1' },
      options: {
        getSubcommand: jest.fn(() => subcommand),
        getChannel: jest.fn(() => channel),
      },
      reply,
    },
    reply,
  };
}

describe('/bot-announcements', () => {
  test('sets the lifecycle announcement channel for the current server', async () => {
    const channel = {
      id: 'channel-1',
      guildId: 'guild-1',
      toString: () => '<#channel-1>',
    };
    const { interaction, reply } = createInteraction({ subcommand: 'set', channel });

    await command.execute(interaction);

    await expect(lifecycleNotificationChannelDAO.findByGuild('guild-1')).resolves.toEqual(
      expect.objectContaining({
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        updated_by: 'admin-1',
      }),
    );
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('<#channel-1>'),
        ephemeral: true,
      }),
    );
  });

  test('reports and clears the lifecycle announcement channel', async () => {
    await lifecycleNotificationChannelDAO.upsert({
      guildId: 'guild-1',
      channelId: 'channel-1',
      updatedBy: 'admin-1',
    });

    const status = createInteraction({ subcommand: 'status' });
    await command.execute(status.interaction);
    expect(status.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Bot announcements are currently set to <#channel-1>.',
        ephemeral: true,
      }),
    );

    const clear = createInteraction({ subcommand: 'clear' });
    await command.execute(clear.interaction);
    await expect(lifecycleNotificationChannelDAO.findByGuild('guild-1')).resolves.toBeNull();
    expect(clear.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Bot announcements are now disabled for this server.',
        ephemeral: true,
      }),
    );
  });

  test('rejects channels from a different server', async () => {
    const channel = {
      id: 'channel-2',
      guildId: 'other-guild',
      toString: () => '<#channel-2>',
    };
    const { interaction, reply } = createInteraction({ subcommand: 'set', channel });

    await command.execute(interaction);

    await expect(lifecycleNotificationChannelDAO.findByGuild('guild-1')).resolves.toBeNull();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'That channel must belong to this server.',
        ephemeral: true,
      }),
    );
  });
});
