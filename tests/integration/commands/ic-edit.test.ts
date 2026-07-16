import { ApplicationCommandType, TextInputStyle } from 'discord.js';

import { ComponentPolicy } from '../../../src/access/components_policy';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../../../src/discord/interaction_dispatch';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';

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

type IcEditCommand = {
  data: { toJSON(): Record<string, unknown> };
  interactionPolicy:
    | InteractionDispatchPolicy
    | ((interaction: ReturnType<typeof commandInteraction>) => InteractionDispatchPolicy);
  execute(
    interaction: ReturnType<typeof commandInteraction>,
    context: InteractionCommandContext,
  ): Promise<unknown>;
};

const icEditCommand = require('../../../src/commands/ic-edit') as IcEditCommand;
const icEditContextCommand = require('../../../src/commands/ic-edit-context') as IcEditCommand;

describe('IC message editing commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('/ic-edit shows a minimal paragraph modal as its first callback without prefetching', async () => {
    const interaction = commandInteraction();

    await executeModalCommand(icEditCommand, interaction);

    expect(icEditCommand.data.toJSON().options).toEqual([
      expect.objectContaining({ name: 'message', required: true }),
    ]);
    expect(fetchContentMock).not.toHaveBeenCalled();
    expectOnlyModalCallback(interaction, '123456789012345678');
  });

  test('Edit IC Message shows a minimal modal as its first callback without prefetching', async () => {
    const interaction = commandInteraction();

    await executeModalCommand(icEditContextCommand, interaction);

    expect(icEditContextCommand.data.toJSON()).toEqual(
      expect.objectContaining({
        name: 'Edit IC Message',
        type: ApplicationCommandType.Message,
      }),
    );
    expect(fetchContentMock).not.toHaveBeenCalled();
    expectOnlyModalCallback(interaction, 'proxy-1');
  });

  test('/ic-edit preserves invalid-reference feedback through an ephemeral reply policy', async () => {
    const interaction = commandInteraction({ message: 'not-a-message' });
    const policy = resolvePolicy(icEditCommand, interaction);
    const responder = new DiscordInteractionResponder(interaction as never, policy.mode);
    await responder.acknowledge();

    await icEditCommand.execute(interaction, { responder });

    expect(policy).toEqual({
      mode: { kind: 'reply', visibility: 'ephemeral' },
      acknowledgement: 'auto-defer',
    });
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '⚠️ Provide a valid message ID or a message link from this server.',
    });
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  test.each([
    ['ic-edit', icEditCommand],
    ['Edit IC Message', icEditContextCommand],
  ])('stops %s cleanly when its modal responder is expired', async (_name, command) => {
    const interaction = commandInteraction();
    const policy = resolvePolicy(command, interaction);
    const responder = new DiscordInteractionResponder(interaction as never, policy.mode);
    responder.expire();

    await expect(command.execute(interaction, { responder })).resolves.not.toThrow();

    expect(fetchContentMock).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  test('modal submission preserves multi-line content', async () => {
    editMessageMock.mockResolvedValue({ status: 'updated' });
    const { handle } = require('../../../src/handlers/modal_handlers/ic_edit_modal');
    const interaction = modalSubmitInteraction();

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

  test('modal submission performs the authoritative ownership check', async () => {
    editMessageMock.mockResolvedValue({ status: 'forbidden' });
    const { handle } = require('../../../src/handlers/modal_handlers/ic_edit_modal');
    const interaction = modalSubmitInteraction();

    await handle(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: '⛔ You can only edit your own proxied RP messages.',
      ephemeral: true,
    });
  });

  test('gates IC edit modal submissions with the character feature policy', () => {
    expect(ComponentPolicy).toContainEqual(['ic-edit-modal:', 'rpg:characters']);
  });
});

async function executeModalCommand(
  command: IcEditCommand,
  interaction: ReturnType<typeof commandInteraction>,
): Promise<void> {
  const policy = resolvePolicy(command, interaction);
  expect(policy).toEqual({
    mode: { kind: 'modal' },
    acknowledgement: 'manual',
    authorization: 'modal-submit',
  });
  const responder = new DiscordInteractionResponder(interaction as never, policy.mode);
  await command.execute(interaction, { responder });
}

function resolvePolicy(
  command: IcEditCommand,
  interaction: ReturnType<typeof commandInteraction>,
): InteractionDispatchPolicy {
  return typeof command.interactionPolicy === 'function'
    ? command.interactionPolicy(interaction)
    : command.interactionPolicy;
}

function expectOnlyModalCallback(
  interaction: ReturnType<typeof commandInteraction>,
  messageId: string,
): void {
  expect(interaction.reply).not.toHaveBeenCalled();
  expect(interaction.deferReply).not.toHaveBeenCalled();
  expect(interaction.showModal).toHaveBeenCalledTimes(1);

  const modal = interaction.showModal.mock.calls[0][0].toJSON();
  expect(modal.custom_id).toBe(`ic-edit-modal:${messageId}`);
  expect(modal.title).toBe('Edit IC Message');
  expect(modal.components[0].components[0]).toEqual(
    expect.objectContaining({
      custom_id: 'content',
      max_length: 2000,
      required: true,
      style: TextInputStyle.Paragraph,
    }),
  );
  expect(modal.components[0].components[0]).not.toHaveProperty('value');
}

function commandInteraction({ message = '123456789012345678' }: { message?: string } = {}) {
  return {
    type: 2,
    commandName: 'ic-edit',
    channelId: 'channel-1',
    client: {},
    guildId: 'guild-1',
    guild: { id: 'guild-1' },
    options: { getString: jest.fn().mockReturnValue(message) },
    targetMessage: { channelId: 'channel-1', id: 'proxy-1' },
    user: { id: 'user-1' },
    replied: false,
    deferred: false,
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    showModal: jest.fn().mockResolvedValue(undefined),
  };
}

function modalSubmitInteraction() {
  return {
    client: {},
    customId: 'ic-edit-modal:proxy-1',
    fields: { getTextInputValue: jest.fn().mockReturnValue('First line\n\nSecond line') },
    guildId: 'guild-1',
    reply: jest.fn().mockResolvedValue(undefined),
    user: { id: 'user-1' },
  };
}
