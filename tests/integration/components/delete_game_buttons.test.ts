import { GameDAO } from '../../../src/dao/game.dao';
import { handle as handleDeleteGame } from '../../../src/components/delete_game_button';
import { handle as handleConfirmDeleteGame } from '../../../src/components/confirm_delete_game_button';

describe('game deletion buttons', () => {
  const gameDAO = new GameDAO();

  async function createGame() {
    return gameDAO.create({
      name: 'Button Campaign',
      description: '',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });
  }

  function responder() {
    return { respond: jest.fn().mockResolvedValue(undefined) };
  }

  test('shows the destructive confirmation only to the game GM', async () => {
    const game = await createGame();
    const gmResponder = responder();

    await handleDeleteGame(
      { customId: `deleteGame:${game.id}`, user: { id: 'gm-1' } } as never,
      gmResponder as never,
    );

    expect(gmResponder.respond).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('all its characters'),
        components: expect.any(Array),
      }),
    );

    const otherResponder = responder();
    await handleDeleteGame(
      { customId: `deleteGame:${game.id}`, user: { id: 'other-user' } } as never,
      otherResponder as never,
    );
    expect(otherResponder.respond).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('permission') }),
    );
  });

  test('rechecks ownership and soft-deletes on confirmation', async () => {
    const game = await createGame();
    const response = responder();

    await handleConfirmDeleteGame(
      { customId: `confirmDeleteGame:${game.id}`, user: { id: 'gm-1' } } as never,
      response as never,
    );

    expect(response.respond).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Deleted **Button Campaign**'),
        components: [],
      }),
    );
    await expect(gameDAO.findById(game.id)).resolves.toBeNull();
  });
});
