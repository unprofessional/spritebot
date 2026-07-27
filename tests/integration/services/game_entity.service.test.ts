import { GameDAO } from '../../../src/dao/game.dao';
import { GameEntityDAO } from '../../../src/dao/game_entity.dao';
import { GameEntityInventoryDAO } from '../../../src/dao/game_entity_inventory.dao';
import { StatTemplateDAO } from '../../../src/dao/stat_template.dao';
import { query } from '../../../src/db/client';
import {
  canManageGameEntity,
  createGameEntity,
  createGameEntityInventoryItem,
  deleteGameEntity,
  deleteGameEntityInventoryItem,
  getGameEntities,
  getGameEntity,
  getRestorableGameEntities,
  restoreGameEntity,
  setGameEntityInventoryEquipped,
  setGameEntityInventoryQuantity,
  updateGameEntityCustomField,
  updateGameEntityCustomFields,
  updateGameEntityInventoryField,
  updateGameEntityInventoryItem,
  updateGameEntityMeta,
  updateGameEntityStat,
  updateGameEntityStats,
} from '../../../src/services/game_entity.service';

describe('game_entity.service', () => {
  const gameDAO = new GameDAO();
  const entityDAO = new GameEntityDAO();
  const inventoryDAO = new GameEntityInventoryDAO();
  const templateDAO = new StatTemplateDAO();

  async function createGame(createdBy = 'gm-1') {
    return gameDAO.create({
      name: 'Entity Service Game',
      description: '',
      created_by: createdBy,
      guild_id: 'guild-1',
    });
  }

  test('creates and hydrates entity stats, defaults, custom fields, and inventory', async () => {
    const game = await createGame();
    const hp = await templateDAO.create({
      game_id: game.id,
      label: 'HP',
      field_type: 'count',
      default_value: '12',
      meta: { default_current: 8 },
      sort_order: 10,
    });
    const armor = await templateDAO.create({
      game_id: game.id,
      label: 'Armor',
      field_type: 'number',
      default_value: '2',
      sort_order: 20,
    });

    const entity = await createGameEntity({
      requesterId: 'gm-1',
      gameId: game.id,
      kind: 'npc',
      name: 'Captain Mira',
      visibility: 'public',
      stats: { [armor.id]: '5' },
      customFields: { Disposition: { value: 'Friendly', meta: { visible: true } } },
    });
    const item = await createGameEntityInventoryItem(entity.id, 'gm-1', {
      name: 'Officer Sword',
      type: 'weapon',
      quantity: 1,
      equipped: true,
      fields: { Damage: '1d8' },
    });

    const hydrated = await getGameEntity(entity.id);

    expect(hydrated).toMatchObject({
      id: entity.id,
      kind: 'npc',
      visibility: 'public',
      customFields: [
        {
          name: 'Disposition',
          value: 'Friendly',
          meta: { visible: true },
        },
      ],
    });
    expect(hydrated?.stats).toEqual([
      expect.objectContaining({
        template_id: hp.id,
        label: 'HP',
        value: '12',
        meta: { current: 8, max: 12 },
        sort_order: 10,
      }),
      expect.objectContaining({
        template_id: armor.id,
        label: 'Armor',
        value: '5',
        sort_order: 20,
      }),
    ]);
    expect(hydrated?.inventory).toEqual([
      expect.objectContaining({
        id: item.id,
        name: 'Officer Sword',
        equipped: true,
        fields: [expect.objectContaining({ name: 'Damage', value: '1d8' })],
      }),
    ]);
  });

  test('requires the active game creator for every mutation', async () => {
    const game = await createGame();
    const entity = await createGameEntity({
      requesterId: 'gm-1',
      gameId: game.id,
      kind: 'creature',
      name: 'Basilisk',
    });
    const template = await templateDAO.create({
      game_id: game.id,
      label: 'HP',
      field_type: 'number',
    });
    const item = await createGameEntityInventoryItem(entity.id, 'gm-1', { name: 'Scale' });

    await expect(
      createGameEntity({
        requesterId: 'player-1',
        gameId: game.id,
        kind: 'npc',
        name: 'Unauthorized',
      }),
    ).rejects.toThrow('Only the game creator');
    await expect(updateGameEntityMeta(entity.id, 'player-1', { name: 'Renamed' })).rejects.toThrow(
      'Only the game creator',
    );
    await expect(updateGameEntityStat(entity.id, 'player-1', template.id, '10')).rejects.toThrow(
      'Only the game creator',
    );
    await expect(
      updateGameEntityCustomField(entity.id, 'player-1', 'Mood', 'Angry'),
    ).rejects.toThrow('Only the game creator');
    await expect(
      updateGameEntityInventoryItem(entity.id, 'player-1', item.id, { name: 'Scale' }),
    ).rejects.toThrow('Only the game creator');
    await expect(deleteGameEntity(entity.id, 'player-1')).rejects.toThrow('Only the game creator');
    await expect(getRestorableGameEntities(game.id, 'player-1')).rejects.toThrow(
      'Only the game creator',
    );
  });

  test('allows the configured bot owner to manage entities without publishing them', async () => {
    const game = await createGame();
    const entity = await createGameEntity({
      requesterId: 'gm-1',
      gameId: game.id,
      kind: 'npc',
      name: 'Owner Managed',
      visibility: 'private',
    });
    const ownerId = process.env.OWNER_DISCORD_ID!;

    await expect(canManageGameEntity(entity.id, ownerId)).resolves.toBe(true);
    await expect(
      updateGameEntityMeta(entity.id, ownerId, { bio: 'Reviewed by owner.' }),
    ).resolves.toMatchObject({
      bio: 'Reviewed by owner.',
      visibility: 'private',
    });
    await expect(deleteGameEntity(entity.id, ownerId)).resolves.toBe(true);
    await expect(restoreGameEntity(entity.id, ownerId)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        entity: expect.objectContaining({ id: entity.id, visibility: 'private' }),
      }),
    );
  });

  test('rejects cross-game stat templates and inventory items', async () => {
    const game = await createGame();
    const otherGame = await createGame('gm-2');
    const entity = await createGameEntity({
      requesterId: 'gm-1',
      gameId: game.id,
      kind: 'npc',
      name: 'Scholar',
    });
    const otherEntity = await createGameEntity({
      requesterId: 'gm-2',
      gameId: otherGame.id,
      kind: 'npc',
      name: 'Other Scholar',
    });
    const otherTemplate = await templateDAO.create({
      game_id: otherGame.id,
      label: 'Lore',
      field_type: 'short',
    });
    const otherItem = await createGameEntityInventoryItem(otherEntity.id, 'gm-2', {
      name: 'Other Book',
    });

    await expect(
      updateGameEntityStat(entity.id, 'gm-1', otherTemplate.id, 'Expert'),
    ).rejects.toThrow('does not belong');
    await expect(
      updateGameEntityStats(entity.id, 'gm-1', { [otherTemplate.id]: 'Expert' }),
    ).rejects.toThrow('does not belong');
    await expect(
      updateGameEntityInventoryItem(entity.id, 'gm-1', otherItem.id, {
        name: 'Stolen Book',
      }),
    ).rejects.toThrow('does not belong');
    await expect(
      updateGameEntityInventoryField(entity.id, 'gm-1', otherItem.id, 'Owner', 'Wrong'),
    ).rejects.toThrow('does not belong');
    await expect(deleteGameEntityInventoryItem(entity.id, 'gm-1', otherItem.id)).rejects.toThrow(
      'does not belong',
    );
  });

  test('rejects operations in a deleted game and hides its entities from reads', async () => {
    const game = await createGame();
    const entity = await createGameEntity({
      requesterId: 'gm-1',
      gameId: game.id,
      kind: 'npc',
      name: 'Dormant',
    });
    await gameDAO.softDelete(game.id);

    await expect(getGameEntity(entity.id)).resolves.toBeNull();
    await expect(getGameEntities(game.id)).resolves.toEqual([]);
    await expect(updateGameEntityMeta(entity.id, 'gm-1', { name: 'Nope' })).rejects.toThrow(
      'not found or inactive',
    );
    await expect(
      createGameEntity({
        requesterId: 'gm-1',
        gameId: game.id,
        kind: 'npc',
        name: 'Nope',
      }),
    ).rejects.toThrow('Game not found or inactive');
  });

  test('updates entity metadata and all inventory mutations', async () => {
    const game = await createGame();
    const entity = await createGameEntity({
      requesterId: 'gm-1',
      gameId: game.id,
      kind: 'creature',
      name: 'Wolf',
    });
    const item = await createGameEntityInventoryItem(entity.id, 'gm-1', {
      name: 'Collar',
      quantity: 1,
    });

    await expect(
      updateGameEntityMeta(entity.id, 'gm-1', {
        name: 'Dire Wolf',
        bio: 'A very large wolf.',
        visibility: 'link-only',
      }),
    ).resolves.toMatchObject({
      name: 'Dire Wolf',
      bio: 'A very large wolf.',
      visibility: 'link-only',
    });
    await expect(
      updateGameEntityInventoryItem(entity.id, 'gm-1', item.id, {
        name: 'Iron Collar',
        quantity: 2,
      }),
    ).resolves.toMatchObject({ name: 'Iron Collar', quantity: 2 });
    await expect(
      updateGameEntityInventoryField(entity.id, 'gm-1', item.id, 'Maker', 'Dwarf'),
    ).resolves.toMatchObject({ name: 'Maker', value: 'Dwarf' });
    await expect(
      setGameEntityInventoryEquipped(entity.id, 'gm-1', item.id, true),
    ).resolves.toMatchObject({ equipped: true });
    await expect(
      setGameEntityInventoryQuantity(entity.id, 'gm-1', item.id, 3),
    ).resolves.toMatchObject({ quantity: 3 });
    await expect(setGameEntityInventoryQuantity(entity.id, 'gm-1', item.id, 0)).rejects.toThrow(
      'positive integer',
    );
    await expect(deleteGameEntityInventoryItem(entity.id, 'gm-1', item.id)).resolves.toBe(true);
    await expect(inventoryDAO.findById(item.id)).resolves.toBeNull();
  });

  test('soft-deletes and restores within 30 days as private', async () => {
    const game = await createGame();
    const entity = await createGameEntity({
      requesterId: 'gm-1',
      gameId: game.id,
      kind: 'npc',
      name: 'Returner',
      visibility: 'public',
    });

    await expect(deleteGameEntity(entity.id, 'gm-1')).resolves.toBe(true);
    await expect(getRestorableGameEntities(game.id, 'gm-1')).resolves.toEqual([
      expect.objectContaining({ id: entity.id, visibility: 'private' }),
    ]);
    await expect(restoreGameEntity(entity.id, 'player-1')).resolves.toEqual({
      ok: false,
      reason: 'not_owner',
    });
    await expect(restoreGameEntity(entity.id, 'gm-1')).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        entity: expect.objectContaining({ id: entity.id, visibility: 'private' }),
      }),
    );
  });

  test('rejects restore after retention expires or while the game is deleted', async () => {
    const game = await createGame();
    const expired = await createGameEntity({
      requesterId: 'gm-1',
      gameId: game.id,
      kind: 'npc',
      name: 'Expired',
    });
    const inactive = await createGameEntity({
      requesterId: 'gm-1',
      gameId: game.id,
      kind: 'npc',
      name: 'Inactive',
    });
    await deleteGameEntity(expired.id, 'gm-1');
    await deleteGameEntity(inactive.id, 'gm-1');
    await query(
      `UPDATE game_entity SET deleted_at = CURRENT_TIMESTAMP - INTERVAL '31 days' WHERE id = $1`,
      [expired.id],
    );

    await expect(restoreGameEntity(expired.id, 'gm-1')).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });
    await gameDAO.softDelete(game.id);
    await expect(restoreGameEntity(inactive.id, 'gm-1')).resolves.toEqual({
      ok: false,
      reason: 'game_inactive',
    });
  });

  test('handles nullable DAO update results without returning stale data', async () => {
    const game = await createGame();
    const entity = await createGameEntity({
      requesterId: 'gm-1',
      gameId: game.id,
      kind: 'npc',
      name: 'Race Target',
    });
    const item = await createGameEntityInventoryItem(entity.id, 'gm-1', {
      name: 'Race Item',
    });
    const metaSpy = jest.spyOn(GameEntityDAO.prototype, 'updateMeta').mockResolvedValueOnce(null);
    const itemSpy = jest
      .spyOn(GameEntityInventoryDAO.prototype, 'updateById')
      .mockResolvedValueOnce(null);

    await expect(updateGameEntityMeta(entity.id, 'gm-1', { name: 'Gone' })).resolves.toBeNull();
    await expect(
      updateGameEntityInventoryItem(entity.id, 'gm-1', item.id, { name: 'Gone' }),
    ).resolves.toBeNull();

    metaSpy.mockRestore();
    itemSpy.mockRestore();
  });

  test('bulk-updates custom fields and compound stat values with metadata', async () => {
    const game = await createGame();
    const template = await templateDAO.create({
      game_id: game.id,
      label: 'Threat',
      field_type: 'short',
    });
    const entity = await createGameEntity({
      requesterId: 'gm-1',
      gameId: game.id,
      kind: 'creature',
      name: 'Hydra',
    });

    await updateGameEntityCustomFields(entity.id, 'gm-1', {
      Habitat: 'Swamp',
      Temperament: { value: 'Hostile', meta: { public: true } },
    });
    await updateGameEntityStats(entity.id, 'gm-1', {
      [template.id]: { value: 'Severe', meta: { source: 'gm' } },
    });

    await expect(getGameEntity(entity.id)).resolves.toEqual(
      expect.objectContaining({
        customFields: [
          expect.objectContaining({ name: 'Habitat', value: 'Swamp' }),
          expect.objectContaining({
            name: 'Temperament',
            value: 'Hostile',
            meta: { public: true },
          }),
        ],
        stats: [
          expect.objectContaining({
            template_id: template.id,
            value: 'Severe',
            meta: { source: 'gm' },
          }),
        ],
      }),
    );
  });

  test('filters entity lists by kind', async () => {
    const game = await createGame();
    await createGameEntity({
      requesterId: 'gm-1',
      gameId: game.id,
      kind: 'npc',
      name: 'Guide',
    });
    await createGameEntity({
      requesterId: 'gm-1',
      gameId: game.id,
      kind: 'creature',
      name: 'Griffin',
    });

    await expect(getGameEntities(game.id, 'npc')).resolves.toEqual([
      expect.objectContaining({ kind: 'npc', name: 'Guide' }),
    ]);
    await expect(getGameEntities(game.id, 'creature')).resolves.toEqual([
      expect.objectContaining({ kind: 'creature', name: 'Griffin' }),
    ]);
  });
});
