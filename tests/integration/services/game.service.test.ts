import { CharacterDAO } from '../../../src/dao/character.dao';
import { GameDAO } from '../../../src/dao/game.dao';
import { PlayerDAO } from '../../../src/dao/player.dao';
import { StatTemplateDAO } from '../../../src/dao/stat_template.dao';
import { query } from '../../../src/db/client';
import { deleteGame, getRestorableGames, restoreGame } from '../../../src/services/game.service';
import {
  isUserInCharacterForChannel,
  setUserChannelInCharacterMode,
} from '../../../src/services/rp_channel_mode.service';

describe('game.service deletion lifecycle', () => {
  const gameDAO = new GameDAO();
  const characterDAO = new CharacterDAO();
  const playerDAO = new PlayerDAO();
  const statTemplateDAO = new StatTemplateDAO();

  async function createGame() {
    return gameDAO.create({
      name: 'The Recoverable Campaign',
      description: '',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });
  }

  async function linkPlayer(discordId: string, gameId: string, characterId: string) {
    await playerDAO.createGlobalPlayer(discordId);
    await playerDAO.ensureServerLink(discordId, 'guild-1');
    await playerDAO.setCurrentGame(discordId, 'guild-1', gameId);
    await playerDAO.setCurrentCharacter(discordId, 'guild-1', characterId);
  }

  test('soft-deletes the game and active characters and clears player selections', async () => {
    const game = await createGame();
    const active = await characterDAO.create({
      user_id: 'player-1',
      game_id: game.id,
      name: 'Active Hero',
      visibility: 'public',
    });
    const independentlyDeleted = await characterDAO.create({
      user_id: 'player-2',
      game_id: game.id,
      name: 'Already Gone',
    });
    await characterDAO.softDelete(independentlyDeleted.id);
    await linkPlayer('player-1', game.id, active.id);
    for (const channelId of ['channel-1', 'channel-2']) {
      await setUserChannelInCharacterMode({
        guildId: 'guild-1',
        channelId,
        userId: 'player-1',
        isIc: true,
      });
    }
    await setUserChannelInCharacterMode({
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'unaffected-player',
      isIc: true,
    });

    const result = await deleteGame(game.id, 'gm-1');

    expect(result).toEqual(
      expect.objectContaining({ ok: true, characterCount: 1, playerCount: 1, rpModeCount: 2 }),
    );
    await expect(gameDAO.findById(game.id)).resolves.toBeNull();
    await expect(characterDAO.findById(active.id)).resolves.toMatchObject({
      deleted_by_game: true,
      visibility: 'private',
    });
    await expect(characterDAO.findById(independentlyDeleted.id)).resolves.toMatchObject({
      deleted_by_game: false,
    });
    await expect(playerDAO.getServerLink('player-1', 'guild-1')).resolves.toMatchObject({
      current_game_id: null,
      current_character_id: null,
    });
    await expect(isUserInCharacterForChannel('guild-1', 'channel-1', 'player-1')).resolves.toBe(
      false,
    );
    await expect(isUserInCharacterForChannel('guild-1', 'channel-2', 'player-1')).resolves.toBe(
      false,
    );
    await expect(
      isUserInCharacterForChannel('guild-1', 'channel-1', 'unaffected-player'),
    ).resolves.toBe(true);
  });

  test('restores only characters deleted with the game and leaves players unassigned', async () => {
    const game = await createGame();
    const gameDeleted = await characterDAO.create({
      user_id: 'player-1',
      game_id: game.id,
      name: 'Returning Hero',
      visibility: 'public',
    });
    const independentlyDeleted = await characterDAO.create({
      user_id: 'player-2',
      game_id: game.id,
      name: 'Still Gone',
    });
    await characterDAO.softDelete(independentlyDeleted.id);
    await linkPlayer('player-1', game.id, gameDeleted.id);
    await deleteGame(game.id, 'gm-1');

    await expect(getRestorableGames('gm-1', 'guild-1')).resolves.toEqual([
      expect.objectContaining({ id: game.id }),
    ]);
    const result = await restoreGame(game.id, 'gm-1');

    expect(result).toEqual(expect.objectContaining({ ok: true, characterCount: 1 }));
    await expect(characterDAO.findById(gameDeleted.id)).resolves.toMatchObject({
      deleted_at: null,
      deleted_by_game: false,
      visibility: 'private',
    });
    await expect(characterDAO.findById(independentlyDeleted.id)).resolves.toMatchObject({
      deleted_by_game: false,
    });
    expect((await characterDAO.findById(independentlyDeleted.id))?.deleted_at).toBeTruthy();
    await expect(playerDAO.getServerLink('player-1', 'guild-1')).resolves.toMatchObject({
      current_game_id: null,
      current_character_id: null,
    });
  });

  test('clears stale IC modes when the player identity was deleted before the game', async () => {
    const game = await createGame();
    const character = await characterDAO.create({
      user_id: 'orphaned-player',
      game_id: game.id,
      name: 'Orphaned Hero',
    });
    await linkPlayer('orphaned-player', game.id, character.id);
    await setUserChannelInCharacterMode({
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'orphaned-player',
      isIc: true,
    });
    await query(`DELETE FROM player WHERE discord_id = $1`, ['orphaned-player']);

    const result = await deleteGame(game.id, 'gm-1');

    expect(result).toEqual(expect.objectContaining({ ok: true, rpModeCount: 1 }));
    await expect(
      isUserInCharacterForChannel('guild-1', 'channel-1', 'orphaned-player'),
    ).resolves.toBe(false);
  });

  test('rejects non-owner deletion and expired restoration', async () => {
    const game = await createGame();

    await expect(deleteGame(game.id, 'other-user')).resolves.toEqual({
      ok: false,
      reason: 'not_owner',
    });
    await deleteGame(game.id, 'gm-1');
    await query(
      `UPDATE game SET deleted_at = CURRENT_TIMESTAMP - INTERVAL '31 days' WHERE id = $1`,
      [game.id],
    );

    await expect(restoreGame(game.id, 'gm-1')).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  test('blocks character, stat, and publish mutations after deletion', async () => {
    const game = await createGame();
    await deleteGame(game.id, 'gm-1');

    await expect(
      characterDAO.create({ user_id: 'player-1', game_id: game.id, name: 'Too Late' }),
    ).rejects.toThrow('inactive game');
    await expect(
      statTemplateDAO.create({ game_id: game.id, label: 'HP', field_type: 'number' }),
    ).rejects.toThrow('inactive game');
    await expect(gameDAO.togglePublish(game.id)).resolves.toBeNull();
  });
});
