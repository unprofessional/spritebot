const rollCommand = require('../../../src/commands/roll') as {
  execute(interaction: unknown): Promise<void>;
};

import { GameDAO } from '../../../src/dao/game.dao';
import { createCharacter } from '../../../src/services/character.service';
import { getOrCreatePlayer, setCurrentGame } from '../../../src/services/player.service';

function createInteraction({
  userId = 'user-1',
  guildId = 'guild-1',
  memberDisplayName = 'Server Sage',
  userDisplayName = 'Account Sage',
  username = 'account_sage',
}: {
  userId?: string;
  guildId?: string | null;
  memberDisplayName?: string | null;
  userDisplayName?: string;
  username?: string;
} = {}) {
  const reply = jest.fn().mockResolvedValue(undefined);
  const getInteger = jest.fn((name: string) => {
    if (name === 'num-dice') return 2;
    if (name === 'num-sides') return 6;
    return null;
  });

  return {
    interaction: {
      guildId,
      member: memberDisplayName === null ? null : { displayName: memberDisplayName },
      user: {
        id: userId,
        displayName: userDisplayName,
        username,
      },
      options: { getInteger },
      reply,
    },
    reply,
  };
}

async function createActiveCharacter(name: string) {
  const game = await new GameDAO().create({
    name: 'Lanternfall',
    description: 'A cozy dungeon crawl',
    created_by: 'user-1',
    guild_id: 'guild-1',
  });

  await getOrCreatePlayer('user-1', 'guild-1');
  await setCurrentGame('user-1', 'guild-1', game.id);

  return createCharacter({
    userId: 'user-1',
    guildId: 'guild-1',
    gameId: game.id,
    name,
  });
}

describe('/roll', () => {
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test('prefers the active character name in a server', async () => {
    await createActiveCharacter('Mira Vale');
    const { interaction, reply } = createInteraction();

    await rollCommand.execute(interaction);

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Mira Vale rolled 2d6'),
        allowedMentions: { parse: [] },
      }),
    );
  });

  test('falls back to the server profile display name without an active character', async () => {
    const { interaction, reply } = createInteraction({ memberDisplayName: 'Table Captain' });

    await rollCommand.execute(interaction);

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Table Captain rolled 2d6'),
        allowedMentions: { parse: [] },
      }),
    );
  });

  test('falls back to the account display name outside a server', async () => {
    const { interaction, reply } = createInteraction({
      guildId: null,
      memberDisplayName: null,
      userDisplayName: 'Wandering Account',
    });

    await rollCommand.execute(interaction);

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Wandering Account rolled 2d6'),
        allowedMentions: { parse: [] },
      }),
    );
  });
});
