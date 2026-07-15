import fs from 'node:fs';
import path from 'node:path';
import { Events, REST } from 'discord.js';

import { beginDrain, DRAINING_REPLY, resetLifecycleForTests } from '../../../src/runtime/lifecycle';

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
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
