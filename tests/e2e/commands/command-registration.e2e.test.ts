import fs from 'node:fs';
import path from 'node:path';
import { Events, REST } from 'discord.js';

import { beginDrain, DRAINING_REPLY, resetLifecycleForTests } from '../../../src/runtime/lifecycle';

jest.mock('../../../src/access/guards', () => ({
  guardCommand: jest.fn().mockResolvedValue(true),
  guardComponent: jest.fn().mockResolvedValue(true),
}));

const commandDir = path.resolve(__dirname, '../../../src/commands');
const opsOnlyCommands = new Set(['gift', 'toggle-bypass']);
const supportOnlyCommands = new Set(['gift', 'verify', 'verify-greeting']);

function commandFilesFromDisk(): string[] {
  return fs
    .readdirSync(commandDir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
}

function commandNamesFromDisk(): string[] {
  return commandFilesFromDisk()
    .map((file) => {
      const command = require(path.join(commandDir, file)) as { data?: { name?: string } };
      return command.data?.name;
    })
    .filter((name): name is string => Boolean(name))
    .sort();
}

describe('command registration', () => {
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    process.env.DISCORD_CLIENT_ID = 'app-1';
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DEV_GUILD_ID = 'ops-guild-1';
    process.env.SUPPORT_GUILD_ID = 'support-guild-1';

    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    resetLifecycleForTests();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    jest.restoreAllMocks();
  });

  test('loads every source command, serializes it for Discord, and indexes it on the client', async () => {
    const restPut = jest.spyOn(REST.prototype, 'put').mockResolvedValue([] as any);
    const { initializeCommands } = require('../../../src/client/initial_commands') as {
      initializeCommands(client: {
        commands?: Map<string, unknown>;
        on: jest.Mock;
        once: jest.Mock;
      }): Promise<unknown>;
    };
    const client = {
      on: jest.fn(),
      once: jest.fn(),
    };

    await initializeCommands(client);

    const expectedNames = commandNamesFromDisk();
    expect([...client.commands.keys()].sort()).toEqual(expectedNames);

    const registeredBodies = restPut.mock.calls.map(([, options]) => {
      const body = (options as { body?: Array<{ name: string }> }).body;
      expect(body).toBeDefined();
      return body ?? [];
    });

    expect(registeredBodies).toHaveLength(3);
    expect([
      ...new Set(
        registeredBodies
          .flat()
          .map((command) => command.name)
          .sort(),
      ),
    ]).toEqual(expectedNames);

    expect(
      registeredBodies
        .flat()
        .map((command) => command.name)
        .sort(),
    ).toEqual([...expectedNames, 'gift'].sort());

    const [globalCommands, opsCommands] = registeredBodies;
    const [, , supportCommands] = registeredBodies;
    expect(globalCommands.map((command) => command.name).sort()).toEqual(
      expectedNames.filter((name) => !opsOnlyCommands.has(name) && !supportOnlyCommands.has(name)),
    );
    expect(opsCommands.map((command) => command.name).sort()).toEqual(
      expectedNames.filter((name) => opsOnlyCommands.has(name)),
    );
    expect(supportCommands.map((command) => command.name).sort()).toEqual(
      expectedNames.filter((name) => supportOnlyCommands.has(name)),
    );
  });

  test('each command module has executable command data', () => {
    for (const file of commandFilesFromDisk()) {
      const command = require(path.join(commandDir, file)) as {
        data?: { name?: string; toJSON?: () => { name: string } };
        execute?: unknown;
      };

      expect(command.data?.name).toBeTruthy();
      expect(typeof command.execute).toBe('function');
      expect(command.data?.toJSON?.()).toEqual(
        expect.objectContaining({ name: command.data?.name }),
      );
    }
  });

  test('routes the create-character production command through its responder policy', async () => {
    jest.spyOn(REST.prototype, 'put').mockResolvedValue([] as any);
    const { initializeCommands } = require('../../../src/client/initial_commands') as {
      initializeCommands(client: {
        commands?: Map<string, unknown>;
        on: jest.Mock;
        once: jest.Mock;
      }): Promise<unknown>;
    };
    const client = {
      on: jest.fn(),
      once: jest.fn(),
    };
    await initializeCommands(client);

    const command = client.commands?.get('create-character') as {
      interactionPolicy?: unknown;
      execute: jest.Mock;
    };
    expect(command.interactionPolicy).toEqual({
      mode: { kind: 'reply', visibility: 'ephemeral' },
      acknowledgement: 'auto-defer',
    });
    command.execute = jest.fn(async (interaction) => {
      await interaction.reply({ content: 'routed', ephemeral: true });
    });

    const interactionListener = client.on.mock.calls.find(
      ([event]) => event === Events.InteractionCreate,
    )?.[1] as ((interaction: unknown) => void) | undefined;
    const interaction = commandInteraction();
    interactionListener?.(interaction);
    await flushPromises();

    expect(command.execute).toHaveBeenCalledTimes(1);
    expect(interaction.reply).toHaveBeenCalledWith({ content: 'routed', ephemeral: true });
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test('defers modal command authorization to the gated modal submission', async () => {
    jest.spyOn(REST.prototype, 'put').mockResolvedValue([] as any);
    const { guardCommand } = require('../../../src/access/guards') as {
      guardCommand: jest.Mock;
    };
    guardCommand.mockClear();
    const { initializeCommands } = require('../../../src/client/initial_commands') as {
      initializeCommands(client: {
        commands?: Map<string, unknown>;
        on: jest.Mock;
        once: jest.Mock;
      }): Promise<unknown>;
    };
    const client = { on: jest.fn(), once: jest.fn() };
    await initializeCommands(client);

    const command = client.commands?.get('ic-edit') as {
      execute: jest.Mock;
    };
    command.execute = jest.fn(async (_interaction, { responder }) => {
      await responder.showModal({ customId: 'ic-edit-modal:message-1' });
    });

    const interactionListener = client.on.mock.calls.find(
      ([event]) => event === Events.InteractionCreate,
    )?.[1] as ((interaction: unknown) => void) | undefined;
    const interaction = {
      ...commandInteraction(),
      commandName: 'ic-edit',
      guildId: 'guild-1',
      guild: { id: 'guild-1' },
      channelId: 'channel-1',
      options: { getString: jest.fn().mockReturnValue('123456789012345678') },
      showModal: jest.fn().mockResolvedValue(undefined),
    };

    interactionListener?.(interaction);
    await flushPromises();

    expect(guardCommand).not.toHaveBeenCalled();
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test('responds to new interactions with a drain message during shutdown', async () => {
    jest.spyOn(REST.prototype, 'put').mockResolvedValue([] as any);
    const { initializeCommands } = require('../../../src/client/initial_commands') as {
      initializeCommands(client: {
        commands?: Map<string, unknown>;
        on: jest.Mock;
        once: jest.Mock;
      }): Promise<unknown>;
    };
    const client = {
      on: jest.fn(),
      once: jest.fn(),
    };
    await initializeCommands(client);

    const interactionListener = client.on.mock.calls.find(
      ([event]) => event === Events.InteractionCreate,
    )?.[1] as ((interaction: unknown) => void) | undefined;
    expect(interactionListener).toBeDefined();

    beginDrain('test');
    const interaction = {
      isRepliable: () => true,
      replied: false,
      deferred: false,
      reply: jest.fn().mockResolvedValue(undefined),
    };

    interactionListener?.(interaction);
    await flushPromises();

    expect(interaction.reply).toHaveBeenCalledWith({
      content: DRAINING_REPLY,
      ephemeral: true,
    });
  });

  test('contains the production double-10062 command and fallback failure', async () => {
    jest.spyOn(REST.prototype, 'put').mockResolvedValue([] as any);
    const { initializeCommands } = require('../../../src/client/initial_commands') as {
      initializeCommands(client: {
        commands?: Map<string, unknown>;
        on: jest.Mock;
        once: jest.Mock;
      }): Promise<unknown>;
    };
    const client = {
      on: jest.fn(),
      once: jest.fn(),
    };
    await initializeCommands(client);

    const expired = () =>
      Object.assign(new Error('Unknown interaction'), {
        name: 'DiscordAPIError',
        code: 10062,
        status: 404,
        url: 'https://discord.com/api/interactions/id/secret-token/callback',
      });
    const execute = jest.fn().mockRejectedValue(expired());
    const command = client.commands?.get('create-character') as Record<string, unknown>;
    client.commands?.set('create-character', { ...command, execute });

    const interactionListener = client.on.mock.calls.find(
      ([event]) => event === Events.InteractionCreate,
    )?.[1] as ((interaction: unknown) => void) | undefined;
    const interaction = {
      type: 2,
      commandName: 'create-character',
      token: 'secret-token',
      isChatInputCommand: () => true,
      isMessageContextMenuCommand: () => false,
      isModalSubmit: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isRepliable: () => true,
      replied: false,
      deferred: false,
      reply: jest.fn().mockRejectedValue(expired()),
      followUp: jest.fn(),
    };
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    try {
      interactionListener?.(interaction);
      await flushPromises();

      expect(execute).toHaveBeenCalledTimes(1);
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'There was an error while executing this action.',
        ephemeral: true,
      });
      expect(unhandled).not.toHaveBeenCalled();
      const logs = [...errorSpy.mock.calls, ...warnSpy.mock.calls].flat().join(' ');
      expect(logs).toContain('command=create-character');
      expect(logs).toContain('code=10062');
      expect(logs).toContain('status=404');
      expect(logs).not.toContain('secret-token');
      expect(logs).not.toContain('/callback');
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  test('contains a failed drain response', async () => {
    jest.spyOn(REST.prototype, 'put').mockResolvedValue([] as any);
    const { initializeCommands } = require('../../../src/client/initial_commands') as {
      initializeCommands(client: {
        commands?: Map<string, unknown>;
        on: jest.Mock;
        once: jest.Mock;
      }): Promise<unknown>;
    };
    const client = {
      on: jest.fn(),
      once: jest.fn(),
    };
    await initializeCommands(client);

    const interactionListener = client.on.mock.calls.find(
      ([event]) => event === Events.InteractionCreate,
    )?.[1] as ((interaction: unknown) => void) | undefined;
    beginDrain('test');
    const interaction = {
      type: 2,
      isRepliable: () => true,
      replied: false,
      deferred: false,
      reply: jest.fn().mockRejectedValue(new Error('drain response failed')),
      followUp: jest.fn(),
    };
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    try {
      interactionListener?.(interaction);
      await flushPromises();

      expect(interaction.reply).toHaveBeenCalledWith({
        content: DRAINING_REPLY,
        ephemeral: true,
      });
      expect(unhandled).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('operation=interaction.drain-fallback'),
      );
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function commandInteraction() {
  return {
    type: 2,
    commandName: 'create-character',
    token: 'secret-token',
    isChatInputCommand: () => true,
    isMessageContextMenuCommand: () => false,
    isModalSubmit: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isRepliable: () => true,
    replied: false,
    deferred: false,
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}
