import { GameDAO } from '../../../src/dao/game.dao';

describe('GameDAO', () => {
  const dao = new GameDAO();

  test('creates and finds a game by id', async () => {
    const created = await dao.create({
      name: 'Shadows Over Briar Glen',
      description: 'A small-town mystery campaign',
      created_by: ' user-1 ',
      guild_id: ' guild-1 ',
    });

    expect(created.id).toEqual(expect.any(String));
    expect(created.name).toBe('Shadows Over Briar Glen');
    expect(created.created_by).toBe('user-1');
    expect(created.guild_id).toBe('guild-1');
    expect(created.is_public).toBe(false);

    const found = await dao.findById(created.id);

    expect(found?.id).toBe(created.id);
  });

  test('toggles publish state', async () => {
    const game = await dao.create({
      name: 'Moonlit Rails',
      description: '',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });

    const published = await dao.togglePublish(game.id);
    const privateAgain = await dao.togglePublish(game.id);

    expect(published?.is_public).toBe(true);
    expect(privateAgain?.is_public).toBe(false);
  });

  test('filters games by guild', async () => {
    await dao.create({
      name: 'Guild One Game',
      description: '',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });
    await dao.create({
      name: 'Guild Two Game',
      description: '',
      created_by: 'gm-2',
      guild_id: 'guild-2',
    });

    const games = await dao.findByGuild('guild-1');

    expect(games).toHaveLength(1);
    expect(games[0].name).toBe('Guild One Game');
  });
});
