const createGameCommand = require('../../../src/commands/create-game') as {
  execute(interaction: unknown): Promise<void>;
};
import { GameDAO } from '../../../src/dao/game.dao';
import { PlayerDAO } from '../../../src/dao/player.dao';

function createInteraction(overrides: { name?: string | null; guildId?: string | null } = {}) {
  const reply = jest.fn().mockResolvedValue(undefined);
  const getString = jest.fn((name: string) => {
    if (name === 'name') return overrides.name ?? 'Lanternfall';
    if (name === 'description') return 'A cozy dungeon crawl';
    return null;
  });

  return {
    interaction: {
      options: { getString },
      guild: overrides.guildId === null ? null : { id: overrides.guildId ?? 'guild-1' },
      user: { id: 'user-1' },
      reply,
    },
    reply,
  };
}

describe('/create-game', () => {
  let logSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('creates a game, creates a GM player link, and sets current game', async () => {
    const { interaction, reply } = createInteraction();

    await createGameCommand.execute(interaction);

    const games = await new GameDAO().findByGuild('guild-1');
    const currentGameId = await new PlayerDAO().getCurrentGame('user-1', 'guild-1');

    expect(games).toHaveLength(1);
    expect(games[0].name).toBe('Lanternfall');
    expect(games[0].created_by).toBe('user-1');
    expect(currentGameId).toBe(games[0].id);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Created game'),
        ephemeral: true,
      }),
    );
  });

  test('rejects use outside a server', async () => {
    const { interaction, reply } = createInteraction({ guildId: null });

    await createGameCommand.execute(interaction);

    expect(await new GameDAO().findAll()).toHaveLength(0);
    expect(reply).toHaveBeenCalledWith({
      content: '⚠️ This command must be used within a server and include a name.',
      ephemeral: true,
    });
  });
});
