import { ApplicationCommandType, TextInputStyle } from 'discord.js';

import { ComponentPolicy } from '../../../src/access/components_policy';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../../../src/discord/interaction_dispatch';
import { dispatchInteractionWithDeadline } from '../../../src/discord/interaction_dispatch';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import { preparedModalInteractionPolicy } from '../../../src/discord/prepared_modal';
import {
  getButtonInteractionPolicy,
  handleButton,
} from '../../../src/handlers/button_handlers/index';
import { getModalInteractionPolicy, handleModal } from '../../../src/handlers/modal_handlers';

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

  test('/ic-edit preserves the prefilled paragraph editor on the fast path', async () => {
    fetchContentMock.mockResolvedValue({ status: 'found', content: 'Original IC content' });
    const interaction = commandInteraction();

    await executeModalCommand(icEditCommand, interaction);

    expect(icEditCommand.data.toJSON().options).toEqual([
      expect.objectContaining({ name: 'message', required: true }),
    ]);
    expect(fetchContentMock).toHaveBeenCalledWith({
      client: interaction.client,
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1',
      messageId: '123456789012345678',
    });
    expectOnlyModalCallback(interaction, '123456789012345678', 'Original IC content');
  });

  test('Edit IC Message preserves the prefilled editor on the fast path', async () => {
    fetchContentMock.mockResolvedValue({ status: 'found', content: 'Context IC content' });
    const interaction = commandInteraction();

    await executeModalCommand(icEditContextCommand, interaction);

    expect(icEditContextCommand.data.toJSON()).toEqual(
      expect.objectContaining({
        name: 'Edit IC Message',
        type: ApplicationCommandType.Message,
      }),
    );
    expect(fetchContentMock).toHaveBeenCalledWith({
      client: interaction.client,
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1',
      messageId: 'proxy-1',
    });
    expectOnlyModalCallback(interaction, 'proxy-1', 'Context IC content');
  });

  test('/ic-edit prepares an owner-bound prefilled editor when acknowledgement wins the race', async () => {
    jest.useFakeTimers();
    let resolveFetch!: (result: { status: 'found'; content: string }) => void;
    fetchContentMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    try {
      const interaction = commandInteraction();
      const policy = resolvePolicy(icEditCommand, interaction);
      const dispatch = dispatchInteractionWithDeadline({
        interaction: interaction as never,
        policy,
        acknowledgementBudgetMs: 10,
        handler: (routedInteraction, responder) =>
          icEditCommand.execute(routedInteraction as never, { responder }),
      });
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(10);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      resolveFetch({ status: 'found', content: 'Prepared IC content' });
      await dispatch;

      expect(interaction.showModal).not.toHaveBeenCalled();
      const preparedPayload = interaction.editReply.mock.calls[0][0];
      expect(preparedPayload.content).toBe(
        'Discord needed a moment. Select **Open editor** to continue where you left off.',
      );
      const customId = preparedPayload.components[0].toJSON().components[0].custom_id;
      expect(customId).toMatch(/^preparedModal:/);

      const intruder = commandInteraction();
      intruder.customId = customId;
      intruder.user.id = 'other-user';
      const intruderResponder = new DiscordInteractionResponder(
        intruder as never,
        preparedModalInteractionPolicy.mode,
      );
      await handleButton(intruder as never, intruderResponder);
      expect(intruder.reply).toHaveBeenCalledWith({
        content: '⚠️ This prepared editor expired. Please start the edit again.',
        ephemeral: true,
      });
      expect(intruder.showModal).not.toHaveBeenCalled();

      const activation = commandInteraction();
      activation.customId = customId;
      const activationResponder = new DiscordInteractionResponder(
        activation as never,
        preparedModalInteractionPolicy.mode,
      );
      expect(getButtonInteractionPolicy(customId)).toBe(preparedModalInteractionPolicy);
      expect(preparedModalInteractionPolicy.acknowledgement).toBe('manual');
      await handleButton(activation as never, activationResponder);

      expectOnlyModalCallback(activation, '123456789012345678', 'Prepared IC content');
    } finally {
      jest.useRealTimers();
    }
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
    const interaction = modalSubmitInteraction();

    await dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: getModalInteractionPolicy(interaction as never),
      handler: handleModal,
    });

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
    const interaction = modalSubmitInteraction();

    await dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: getModalInteractionPolicy(interaction as never),
      handler: handleModal,
    });

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
    mode: { kind: 'modal-or-reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
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
  content: string,
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
      value: content,
    }),
  );
}

function commandInteraction({ message = '123456789012345678' }: { message?: string } = {}) {
  return {
    type: 2,
    commandName: 'ic-edit',
    customId: '',
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
