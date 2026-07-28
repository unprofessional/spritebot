const createGameCommand = require('../../../src/commands/create-game') as {
  execute(interaction: unknown, context: unknown): Promise<void>;
};
import { GameDAO } from '../../../src/dao/game.dao';
import { PlayerDAO } from '../../../src/dao/player.dao';
import { StatTemplateDAO } from '../../../src/dao/stat_template.dao';

function createInteraction(
  overrides: { name?: string | null; guildId?: string | null; preset?: string | null } = {},
) {
  const reply = jest.fn().mockResolvedValue(undefined);
  const getString = jest.fn((name: string) => {
    if (name === 'name') return overrides.name ?? 'Lanternfall';
    if (name === 'description') return 'A cozy dungeon crawl';
    if (name === 'preset') return overrides.preset ?? null;
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
    responderContext: { responder: { respond: reply } },
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
    const { interaction, reply, responderContext } = createInteraction();

    await createGameCommand.execute(interaction, responderContext);

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
    const { interaction, reply, responderContext } = createInteraction({ guildId: null });

    await createGameCommand.execute(interaction, responderContext);

    expect(await new GameDAO().findAll()).toHaveLength(0);
    expect(reply).toHaveBeenCalledWith({
      content: '⚠️ This command must be used within a server and include a name.',
      ephemeral: true,
    });
  });

  test('optionally applies the FFRP preset as ordinary custom stats', async () => {
    const { interaction, reply, responderContext } = createInteraction({ preset: 'ffrp' });

    await createGameCommand.execute(interaction, responderContext);

    const game = (await new GameDAO().findByGuild('guild-1'))[0]!;
    const stats = await new StatTemplateDAO().findByGame(game.id);

    expect(game).toMatchObject({ preset_key: 'ffrp', preset_version: 1 });
    expect(stats).toEqual([
      expect.objectContaining({
        stat_key: 'hp',
        label: 'HP',
        field_type: 'count',
        default_value: '0',
      }),
      expect.objectContaining({
        stat_key: 'fp',
        label: 'FP',
        field_type: 'count',
        default_value: '0',
      }),
    ]);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Applied the **FFRP**') }),
    );
  });
});
