import { ApplicationCommandType, TextInputStyle } from 'discord.js';

jest.mock('../../../src/services/rp_message_proxy.service', () => ({
  editRoleplayProxyMessage: jest.fn(),
  fetchProxyMessageContent: jest.fn(),
}));

import {
  editRoleplayProxyMessage,
  fetchProxyMessageContent,
} from '../../../src/services/rp_message_proxy.service';

const fetchContentMock = fetchProxyMessageContent as jest.MockedFunction<
  typeof fetchProxyMessageContent
>;
const editMessageMock = editRoleplayProxyMessage as jest.MockedFunction<
  typeof editRoleplayProxyMessage
>;

describe('IC message editing commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('/ic-edit opens a paragraph modal pre-filled with current Discord content', async () => {
    fetchContentMock.mockResolvedValue({ status: 'found', content: 'First line\n\nSecond line' });
    const command = require('../../../src/commands/ic-edit');
    const interaction = {
      channelId: 'channel-1',
      client: {},
      guildId: 'guild-1',
      options: { getString: jest.fn().mockReturnValue('123456789012345678') },
      reply: jest.fn(),
      showModal: jest.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
    };

    await command.execute(interaction);

    expect(command.data.toJSON().options).toEqual([
      expect.objectContaining({ name: 'message', required: true }),
    ]);
    const modal = interaction.showModal.mock.calls[0][0].toJSON();
    expect(modal.custom_id).toBe('ic-edit-modal:123456789012345678');
    expect(modal.title).toBe('Edit IC Message');
    expect(modal.components[0].components[0]).toEqual(
      expect.objectContaining({
        custom_id: 'content',
        max_length: 2000,
        required: true,
        style: TextInputStyle.Paragraph,
        value: 'First line\n\nSecond line',
      }),
    );
  });

  test('message context command rejects a proxied message owned by someone else', async () => {
    fetchContentMock.mockResolvedValue({ status: 'forbidden' });
    const command = require('../../../src/commands/ic-edit-context');
    const interaction = {
      client: {},
      guildId: 'guild-1',
      reply: jest.fn().mockResolvedValue(undefined),
      showModal: jest.fn(),
      targetMessage: { channelId: 'channel-1', id: 'proxy-1' },
      user: { id: 'user-2' },
    };

    await command.execute(interaction);

    expect(command.data.toJSON()).toEqual(
      expect.objectContaining({
        name: 'Edit IC Message',
        type: ApplicationCommandType.Message,
      }),
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content: '⛔ You can only edit your own proxied RP messages.',
      ephemeral: true,
    });
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  test('modal submission preserves multi-line content', async () => {
    editMessageMock.mockResolvedValue({ status: 'updated' });
    const { handle } = require('../../../src/handlers/modal_handlers/ic_edit_modal');
    const interaction = {
      client: {},
      customId: 'ic-edit-modal:proxy-1',
      fields: { getTextInputValue: jest.fn().mockReturnValue('First line\n\nSecond line') },
      guildId: 'guild-1',
      reply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
    };

    await handle(interaction);

    expect(editMessageMock).toHaveBeenCalledWith({
      client: interaction.client,
      guildId: 'guild-1',
      userId: 'user-1',
      messageId: 'proxy-1',
      content: 'First line\n\nSecond line',
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: '✅ Updated your proxied RP message.',
      ephemeral: true,
    });
  });
});
