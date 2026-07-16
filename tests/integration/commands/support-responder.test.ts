import { GiftedGuildsDAO } from '../../../src/dao/gifted_guilds.dao';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../../../src/discord/interaction_dispatch';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import * as entitlementsService from '../../../src/services/entitlements.service';

type SupportCommand = {
  interactionPolicy: InteractionDispatchPolicy;
  execute(interaction: unknown, context: InteractionCommandContext): Promise<unknown>;
};

const giftCommand = require('../../../src/commands/gift') as SupportCommand;
const subscribeCommand = require('../../../src/commands/subscribe') as SupportCommand;
const supportCommand = require('../../../src/commands/support') as SupportCommand;
const toggleBypassCommand = require('../../../src/commands/toggle-bypass') as SupportCommand;
const verifyCommand = require('../../../src/commands/verify') as SupportCommand;

describe('support, subscription, and ops command responder migration', () => {
  let errorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    errorSpy.mockRestore();
  });

  test('/support preserves its invite response after deferral', async () => {
    const interaction = commandInteraction();

    await executePreDeferred(supportCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('https://discord.gg/eXktxzKxze'),
    });
  });

  test('/subscribe preserves its premium embed and button after deferral', async () => {
    jest.spyOn(entitlementsService, 'getEntitlementsFor').mockResolvedValue({
      status: 'active',
      planName: 'Core',
      features: new Set(['core']),
      expiresAt: null,
    });
    jest.spyOn(GiftedGuildsDAO.prototype, 'isGifted').mockResolvedValue(false);
    const interaction = commandInteraction({ applicationId: 'application-1' });

    await executePreDeferred(subscribeCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      }),
    );
    expect(JSON.stringify(interaction.editReply.mock.calls[0][0])).toContain('1405308360818954322');
  });

  test('/verify preserves its support-server rejection after deferral', async () => {
    const interaction = commandInteraction({ guildId: 'not-support' });

    await executePreDeferred(verifyCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Use `/verify` in the SPRITEbot support server.',
    });
  });

  test('/gift preserves its owner rejection after deferral', async () => {
    const interaction = commandInteraction({ userId: 'not-owner' });

    await executePreDeferred(giftCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: '⛔ Not authorized.' });
  });

  test('/toggle-bypass preserves its ops-guild rejection after deferral', async () => {
    const interaction = commandInteraction({ guildId: 'not-ops' });

    await executePreDeferred(toggleBypassCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: '⛔ Not available here.' });
  });

  test.each([
    ['support', supportCommand],
    ['subscribe', subscribeCommand],
    ['verify', verifyCommand],
    ['gift', giftCommand],
    ['toggle-bypass', toggleBypassCommand],
  ])('stops /%s cleanly when its responder is expired', async (_name, command) => {
    const interaction = commandInteraction({ guildId: null, userId: 'not-owner' });
    const responder = new DiscordInteractionResponder(
      interaction as never,
      command.interactionPolicy.mode,
    );
    responder.expire();

    await expect(command.execute(interaction, { responder })).resolves.not.toThrow();

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
});

async function executePreDeferred(
  command: SupportCommand,
  interaction: ReturnType<typeof commandInteraction>,
): Promise<void> {
  expect(command.interactionPolicy).toEqual({
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  });
  const responder = new DiscordInteractionResponder(
    interaction as never,
    command.interactionPolicy.mode,
  );
  await responder.acknowledge();
  await command.execute(interaction, { responder });
}

function expectEphemeralDeferral(interaction: ReturnType<typeof commandInteraction>): void {
  expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
  expect(interaction.reply).not.toHaveBeenCalled();
  expect(interaction.followUp).not.toHaveBeenCalled();
}

function commandInteraction({
  applicationId,
  guildId = 'guild-1',
  userId = 'user-1',
}: {
  applicationId?: string;
  guildId?: string | null;
  userId?: string;
} = {}) {
  return {
    type: 2,
    commandName: 'support-command',
    guildId,
    guild: guildId
      ? { id: guildId, members: { fetch: jest.fn().mockResolvedValue({ id: userId }) } }
      : null,
    client: {
      application: applicationId ? { id: applicationId } : null,
      guilds: { cache: new Map() },
    },
    options: {
      getSubcommand: jest.fn().mockReturnValue('list'),
      getString: jest.fn().mockReturnValue(null),
      getInteger: jest.fn().mockReturnValue(null),
    },
    user: { id: userId },
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
