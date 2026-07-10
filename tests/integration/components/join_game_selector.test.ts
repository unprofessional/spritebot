import { GameDAO } from '../../../src/dao/game.dao';
import { build as buildJoinGameSelector } from '../../../src/components/join_game_selector';

describe('join game selector', () => {
  const gameDao = new GameDAO();

  test('offers public games in the current guild that the user did not create', async () => {
    const publicGame = await gameDao.create({
      name: 'Vangal',
      description: 'Sprite campaign',
      created_by: 'gren',
      guild_id: 'guild-1',
    });
    await gameDao.togglePublish(publicGame.id);

    const privateGame = await gameDao.create({
      name: 'Draft Game',
      description: '',
      created_by: 'gren',
      guild_id: 'guild-1',
    });

    const otherGuildGame = await gameDao.create({
      name: 'Other Server Game',
      description: '',
      created_by: 'someone-else',
      guild_id: 'guild-2',
    });
    await gameDao.togglePublish(otherGuildGame.id);

    const ownGame = await gameDao.create({
      name: 'My Own Game',
      description: '',
      created_by: 'player-1',
      guild_id: 'guild-1',
    });
    await gameDao.togglePublish(ownGame.id);

    const response = await buildJoinGameSelector('player-1', 'guild-1');

    expect(response.content).toBe('🎲 Choose a game you want to join:');
    expect('components' in response ? response.components : []).toHaveLength(1);

    const row = 'components' in response ? response.components[0].toJSON() : null;
    const select = row?.components[0];

    expect(select?.options).toEqual([
      expect.objectContaining({
        label: 'Vangal',
        value: publicGame.id,
      }),
    ]);
    expect(select?.options).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: privateGame.id }),
        expect.objectContaining({ value: otherGuildGame.id }),
        expect.objectContaining({ value: ownGame.id }),
      ]),
    );
  });

  test('explains when no games exist in the server', async () => {
    const response = await buildJoinGameSelector('player-1', 'guild-1');

    expect(response).toEqual({
      content: [
        '📭 There are no joinable public games in this server right now.',
        '',
        'If you created a game, you’re already considered a player as the **Game Master**.',
        '',
        '💡 No games exist in this server yet. A GM can create one with `/create-game`.',
      ].join('\n'),
      ephemeral: true,
    });
  });

  test('explains when games exist but none are joinable', async () => {
    await gameDao.create({
      name: 'Draft Game',
      description: '',
      created_by: 'gren',
      guild_id: 'guild-1',
    });

    const response = await buildJoinGameSelector('player-1', 'guild-1');

    expect(response).toEqual({
      content: [
        '📭 There are no joinable public games in this server right now.',
        '',
        'If you created a game, you’re already considered a player as the **Game Master**.',
        '',
        "💡 If you're the GM, your game might need to be published first. Use `/view-game` to check.",
      ].join('\n'),
      ephemeral: true,
    });
  });
});
