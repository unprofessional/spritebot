import { query } from '../../../src/db/client';

describe('ordinary custom-stat schema', () => {
  test('enforces stat-key uniqueness per game without migration helpers', async () => {
    const games = await query<{ id: string }>(
      `INSERT INTO game (guild_id, name, created_by)
       VALUES
         ('guild-1', 'First Game', 'gm-1'),
         ('guild-1', 'Second Game', 'gm-1')
       RETURNING id`,
    );
    const [firstGame, secondGame] = games.rows;

    await query(
      `INSERT INTO stat_template (game_id, stat_key, label)
       VALUES ($1, 'stress', 'Stress')`,
      [firstGame!.id],
    );

    await expect(
      query(
        `INSERT INTO stat_template (game_id, stat_key, label)
         VALUES ($1, 'stress', 'Pressure')`,
        [firstGame!.id],
      ),
    ).rejects.toThrow();

    await expect(
      query(
        `INSERT INTO stat_template (game_id, stat_key, label)
         VALUES ($1, 'stress', 'Stress')`,
        [secondGame!.id],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});
