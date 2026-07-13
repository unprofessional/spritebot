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

  test('/ic-delete asks for confirmation before deleting a tracked proxied message by id', async () => {
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

    const reply = interaction.reply.mock.calls[0][0];
    const row = reply.components[0].toJSON();

    expect(command.data.toJSON().options).toEqual([
      expect.objectContaining({ name: 'message', required: true }),
    ]);
    expect(deleteMessageMock).not.toHaveBeenCalled();
    expect(reply).toEqual(
      expect.objectContaining({
        content: 'Delete this proxied RP message?',
        ephemeral: true,
      }),
    );
    expect(row.components[0]).toEqual(
      expect.objectContaining({
        custom_id: 'confirmIcDelete:channel-1:123456789012345678:user-1',
        label: 'Confirm Delete',
      }),
    );
    expect(row.components[1]).toEqual(
      expect.objectContaining({
        custom_id: 'cancelIcDelete:channel-1:123456789012345678:user-1',
        label: 'Cancel',
      }),
    );
  });

  test('message context command asks for confirmation before deleting', async () => {
    const command = require('../../../src/commands/ic-delete-context');
    const interaction = {
      client: {},
      guildId: 'guild-1',
      reply: jest.fn().mockResolvedValue(undefined),
      targetMessage: { channelId: 'channel-1', id: 'proxy-1' },
      user: { id: 'user-2' },
    };

    await command.execute(interaction);

    const reply = interaction.reply.mock.calls[0][0];
    const row = reply.components[0].toJSON();

    expect(command.data.toJSON()).toEqual(
      expect.objectContaining({
        name: 'Delete IC Message',
        type: ApplicationCommandType.Message,
      }),
    );
    expect(deleteMessageMock).not.toHaveBeenCalled();
    expect(reply).toEqual(
      expect.objectContaining({
        content: 'Delete this proxied RP message?',
        ephemeral: true,
      }),
    );
    expect(row.components[0]).toEqual(
      expect.objectContaining({
        custom_id: 'confirmIcDelete:channel-1:proxy-1:user-2',
        label: 'Confirm Delete',
      }),
    );
  });

  test('confirmation button deletes the proxied message', async () => {
    deleteMessageMock.mockResolvedValue({ status: 'deleted' });
    const { handle } = require('../../../src/components/confirm_ic_delete_button');
    const interaction = {
      client: {},
      customId: 'confirmIcDelete:channel-1:proxy-1:user-1',
      guildId: 'guild-1',
      update: jest.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
    };

    await handle(interaction);

    expect(deleteMessageMock).toHaveBeenCalledWith({
      client: interaction.client,
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1',
      messageId: 'proxy-1',
    });
    expect(interaction.update).toHaveBeenCalledWith({
      content: '🗑️ Deleted your proxied RP message.',
      components: [],
    });
  });

  test('confirmation button rejects another user', async () => {
    const { handle } = require('../../../src/components/confirm_ic_delete_button');
    const interaction = {
      customId: 'confirmIcDelete:channel-1:proxy-1:user-1',
      guildId: 'guild-1',
      reply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'user-2' },
    };

    await handle(interaction);

    expect(deleteMessageMock).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: '⛔ Only the person who requested this delete can confirm it.',
      ephemeral: true,
    });
  });

  test('cancel button clears the delete confirmation', async () => {
    const { handle } = require('../../../src/components/confirm_ic_delete_button');
    const interaction = {
      customId: 'cancelIcDelete:channel-1:proxy-1:user-1',
      guildId: 'guild-1',
      update: jest.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
    };

    await handle(interaction);

    expect(deleteMessageMock).not.toHaveBeenCalled();
    expect(interaction.update).toHaveBeenCalledWith({
      content: 'Deletion canceled.',
      components: [],
    });
  });
});
