import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../../../src/discord/interaction_dispatch';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';

type RemainingCommand = {
  interactionPolicy: InteractionDispatchPolicy;
  execute(interaction: unknown, context: InteractionCommandContext): Promise<unknown>;
};

const bumpThreadCommand = require('../../../src/commands/bump-thread') as RemainingCommand;
const transcribeCommand = require('../../../src/commands/transcribe') as RemainingCommand;
const verifyGreetingCommand = require('../../../src/commands/verify-greeting') as RemainingCommand;

const commands: Array<[string, RemainingCommand]> = [
  ['transcribe', transcribeCommand],
  ['bump-thread', bumpThreadCommand],
  ['verify-greeting', verifyGreetingCommand],
];

describe('remaining command responder migration', () => {
  test.each(commands)('/%s declares an ephemeral auto-defer policy', (_name, command) => {
    expect(command.interactionPolicy).toEqual({
      mode: { kind: 'reply', visibility: 'ephemeral' },
      acknowledgement: 'auto-defer',
    });
  });

  test('/transcribe preserves its server-only rejection after deferral', async () => {
    const interaction = commandInteraction({ guildId: null });

    await executePreDeferred(transcribeCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '⚠️ This command must be used in a server.',
    });
  });

  test('/bump-thread preserves its permission rejection after deferral', async () => {
    const interaction = commandInteraction();

    await executePreDeferred(bumpThreadCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '❌ You need **Manage Threads** to do that.',
      flags: 64,
    });
  });

  test('/verify-greeting preserves its owner rejection after deferral', async () => {
    const interaction = commandInteraction({ userId: 'not-owner' });

    await executePreDeferred(verifyGreetingCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: '⛔ Not authorized.' });
  });

  test.each(commands)('stops /%s cleanly when its responder is expired', async (name, command) => {
    const interaction = commandInteraction({
      commandName: name,
      guildId: name === 'transcribe' ? null : 'guild-1',
      userId: 'not-owner',
    });
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
  command: RemainingCommand,
  interaction: ReturnType<typeof commandInteraction>,
): Promise<void> {
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
  commandName = 'remaining-command',
  guildId = 'guild-1',
  userId = 'user-1',
}: {
  commandName?: string;
  guildId?: string | null;
  userId?: string;
} = {}) {
  return {
    type: 2,
    commandName,
    guildId,
    guild: guildId ? { id: guildId } : null,
    channel: null,
    channelId: 'channel-1',
    memberPermissions: { has: jest.fn().mockReturnValue(false) },
    client: {
      channels: { fetch: jest.fn().mockResolvedValue(null) },
      guilds: { cache: new Map() },
    },
    options: {
      getSubcommand: jest.fn().mockReturnValue('status'),
      getChannel: jest.fn().mockReturnValue(null),
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
