import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../../../src/discord/interaction_dispatch';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import * as joinGameSelector from '../../../src/components/join_game_selector';
import * as restoreCharacterSelector from '../../../src/components/restore_character_selector';
import * as switchCharacterSelector from '../../../src/components/switch_character_selector';
import * as switchGameSelector from '../../../src/components/switch_game_selector';

type MutationCommand = {
  interactionPolicy: InteractionDispatchPolicy;
  execute(interaction: unknown, context: InteractionCommandContext): Promise<unknown>;
};

const createCharacterCommand = require('../../../src/commands/create-character') as MutationCommand;
const createGameCommand = require('../../../src/commands/create-game') as MutationCommand;
const joinGameCommand = require('../../../src/commands/join-game') as MutationCommand;
const restoreCharacterCommand =
  require('../../../src/commands/restore-character') as MutationCommand;
const switchCharacterCommand = require('../../../src/commands/switch-character') as MutationCommand;
const switchGameCommand = require('../../../src/commands/switch-game') as MutationCommand;

describe('character and game mutation command responder migration', () => {
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('/create-game preserves its success content and components after deferral', async () => {
    const interaction = commandInteraction({
      strings: { name: 'Lanternfall', description: 'A cozy dungeon crawl' },
    });

    await executePreDeferred(createGameCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Created game and set it as your active campaign'),
        components: expect.any(Array),
      }),
    );
  });

  test('/create-game does not retry when its deferred Discord callback fails', async () => {
    const interaction = commandInteraction({ strings: { name: 'Lanternfall' } });
    interaction.editReply.mockRejectedValue(new Error('socket closed'));

    await expect(executePreDeferred(createGameCommand, interaction)).rejects.toThrow(
      'socket closed',
    );

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  test('/create-character preserves its server-only rejection after deferral', async () => {
    const interaction = commandInteraction({ guildId: null });

    await executePreDeferred(createCharacterCommand, interaction);

    expectEphemeralDeferral(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '⚠️ You must use this command in a server.',
    });
  });

  test.each([
    ['join-game', joinGameCommand, joinGameSelector, '🎲 Choose a game you want to join:'],
    ['switch-game', switchGameCommand, switchGameSelector, '🎲 Choose your active game:'],
    [
      'switch-character',
      switchCharacterCommand,
      switchCharacterSelector,
      '🎭 Choose your active character:',
    ],
    [
      'restore-character',
      restoreCharacterCommand,
      restoreCharacterSelector,
      '♻️ Choose a character to restore.',
    ],
  ])(
    '/%s preserves selector content and components after deferral',
    async (_name, command, module, content) => {
      const components = [{ type: 1, components: [{ type: 3, custom_id: `${_name}-selector` }] }];
      jest
        .spyOn(module, 'build')
        .mockResolvedValue({ content, components, ephemeral: true } as never);
      const interaction = commandInteraction();

      await executePreDeferred(command, interaction);

      expectEphemeralDeferral(interaction);
      expect(interaction.editReply).toHaveBeenCalledWith({ content, components });
    },
  );

  test.each([
    ['create-game', createGameCommand],
    ['create-character', createCharacterCommand],
    ['join-game', joinGameCommand],
    ['switch-game', switchGameCommand],
    ['switch-character', switchCharacterCommand],
    ['restore-character', restoreCharacterCommand],
  ])('stops /%s cleanly when its responder is expired', async (_name, command) => {
    const interaction = commandInteraction({ guildId: null, strings: { name: null } });
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
  command: MutationCommand,
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
  guildId = 'guild-1',
  strings = {},
}: {
  guildId?: string | null;
  strings?: Record<string, string | null>;
} = {}) {
  return {
    type: 2,
    commandName: 'mutation-command',
    guildId,
    guild: guildId ? { id: guildId } : null,
    user: { id: 'user-1' },
    options: {
      getString: jest.fn((name: string) => strings[name] ?? null),
    },
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
