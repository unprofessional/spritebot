import { ApplicationCommandType } from 'discord.js';

jest.mock('../../../src/services/rp_message_proxy.service', () => ({
  deleteRoleplayProxyMessage: jest.fn(),
}));

import { deleteRoleplayProxyMessage } from '../../../src/services/rp_message_proxy.service';

const deleteMessageMock = deleteRoleplayProxyMessage as jest.MockedFunction<
  typeof deleteRoleplayProxyMessage
>;

describe('IC message delete commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('/ic-delete deletes a tracked proxied message by id', async () => {
    deleteMessageMock.mockResolvedValue({ status: 'deleted' });
    const command = require('../../../src/commands/ic-delete');
    const interaction = {
      channelId: 'channel-1',
      client: {},
      guildId: 'guild-1',
      options: { getString: jest.fn().mockReturnValue('123456789012345678') },
      reply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
    };

    await command.execute(interaction);

    expect(command.data.toJSON().options).toEqual([
      expect.objectContaining({ name: 'message', required: true }),
    ]);
    expect(deleteMessageMock).toHaveBeenCalledWith({
      client: interaction.client,
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1',
      messageId: '123456789012345678',
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: '🗑️ Deleted your proxied RP message.',
      ephemeral: true,
    });
  });

  test('message context command rejects a proxied message owned by someone else', async () => {
    deleteMessageMock.mockResolvedValue({ status: 'forbidden' });
    const command = require('../../../src/commands/ic-delete-context');
    const interaction = {
      client: {},
      guildId: 'guild-1',
      reply: jest.fn().mockResolvedValue(undefined),
      targetMessage: { channelId: 'channel-1', id: 'proxy-1' },
      user: { id: 'user-2' },
    };

    await command.execute(interaction);

    expect(command.data.toJSON()).toEqual(
      expect.objectContaining({
        name: 'Delete IC Message',
        type: ApplicationCommandType.Message,
      }),
    );
    expect(deleteMessageMock).toHaveBeenCalledWith({
      client: interaction.client,
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-2',
      messageId: 'proxy-1',
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: '⛔ You can only delete your own proxied RP messages.',
      ephemeral: true,
    });
  });
});
