import { GameDAO } from '../../../src/dao/game.dao';
import { query } from '../../../src/db/client';

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

  test('soft-deletes, filters, and restores a game', async () => {
    const game = await dao.create({
      name: 'Recoverable Table',
      description: '',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });

    const deleted = await dao.softDelete(game.id);

    expect(deleted?.deleted_at).toBeTruthy();
    await expect(dao.findById(game.id)).resolves.toBeNull();
    await expect(dao.findByGuild('guild-1')).resolves.toEqual([]);
    await expect(dao.findByIdIncludingDeleted(game.id)).resolves.toMatchObject({ id: game.id });

    const restored = await dao.restore(game.id);

    expect(restored?.deleted_at).toBeNull();
    await expect(dao.findById(game.id)).resolves.toMatchObject({ id: game.id });
  });

  test('finds only expired soft-deleted games', async () => {
    const expired = await dao.create({
      name: 'Expired Table',
      description: '',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });
    const recoverable = await dao.create({
      name: 'Recoverable Table',
      description: '',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });
    await dao.softDelete(expired.id);
    await dao.softDelete(recoverable.id);
    await query(
      `UPDATE game SET deleted_at = CURRENT_TIMESTAMP - INTERVAL '31 days' WHERE id = $1`,
      [expired.id],
    );

    await expect(dao.findExpiredSoftDeletes(30)).resolves.toEqual([
      expect.objectContaining({ id: expired.id }),
    ]);
  });
});
