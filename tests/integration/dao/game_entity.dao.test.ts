import { GameDAO } from '../../../src/dao/game.dao';
import { GameEntityDAO } from '../../../src/dao/game_entity.dao';
import { GameEntityCustomFieldDAO } from '../../../src/dao/game_entity_custom_field.dao';
import { GameEntityInventoryDAO } from '../../../src/dao/game_entity_inventory.dao';
import { GameEntityInventoryFieldDAO } from '../../../src/dao/game_entity_inventory_field.dao';
import { GameEntityStatFieldDAO } from '../../../src/dao/game_entity_stat_field.dao';
import { StatTemplateDAO } from '../../../src/dao/stat_template.dao';
import { query } from '../../../src/db/client';

describe('game entity DAOs', () => {
  const gameDAO = new GameDAO();
  const entityDAO = new GameEntityDAO();
  const statDAO = new GameEntityStatFieldDAO();
  const customDAO = new GameEntityCustomFieldDAO();
  const inventoryDAO = new GameEntityInventoryDAO();
  const inventoryFieldDAO = new GameEntityInventoryFieldDAO();

  async function createGame() {
    return gameDAO.create({
      name: 'Entity Test Game',
      description: '',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });
  }

  test('creates, lists, updates, soft-deletes, and restores both entity kinds', async () => {
    const game = await createGame();
    const npc = await entityDAO.create({
      game_id: game.id,
      created_by: ' gm-1 ',
      kind: 'npc',
      name: 'Innkeeper',
      visibility: 'public',
    });
    const creature = await entityDAO.create({
      game_id: game.id,
      created_by: 'gm-1',
      kind: 'creature',
      name: 'Owlbear',
    });

    expect(npc).toMatchObject({
      game_id: game.id,
      created_by: 'gm-1',
      kind: 'npc',
      visibility: 'public',
    });
    await expect(entityDAO.findByGame(game.id, 'creature')).resolves.toEqual([
      expect.objectContaining({ id: creature.id }),
    ]);

    await expect(
      entityDAO.updateMeta(npc.id, {
        name: 'The Innkeeper',
        bio: 'Knows every rumor.',
        visibility: 'link-only',
      }),
    ).resolves.toMatchObject({ name: 'The Innkeeper', visibility: 'link-only' });

    const deleted = await entityDAO.softDelete(npc.id);
    expect(deleted).toMatchObject({ visibility: 'private', deleted_by_game: false });
    expect(deleted?.deleted_at).toBeTruthy();
    await expect(entityDAO.findActiveById(npc.id)).resolves.toBeNull();
    await expect(entityDAO.findRestorableByGame(game.id)).resolves.toEqual([
      expect.objectContaining({ id: npc.id }),
    ]);

    const restored = await entityDAO.restore(npc.id);
    expect(restored).toMatchObject({ visibility: 'private', deleted_at: null });
  });

  test('rejects invalid kinds, visibility, and creation for missing or deleted games', async () => {
    const game = await createGame();
    await gameDAO.softDelete(game.id);

    await expect(
      entityDAO.create({
        game_id: game.id,
        created_by: 'gm-1',
        kind: 'npc',
        name: 'Hidden NPC',
      }),
    ).rejects.toThrow(`Cannot create a game entity for inactive game ${game.id}`);

    await expect(
      query(`INSERT INTO game_entity (game_id, created_by, kind, name) VALUES ($1, $2, $3, $4)`, [
        game.id,
        'gm-1',
        'dragon',
        'Invalid',
      ]),
    ).rejects.toThrow();
    await expect(
      query(
        `INSERT INTO game_entity (game_id, created_by, kind, name, visibility)
         VALUES ($1, $2, $3, $4, $5)`,
        [game.id, 'gm-1', 'npc', 'Invalid', 'secret'],
      ),
    ).rejects.toThrow();
    await expect(
      entityDAO.create({
        game_id: '00000000-0000-0000-0000-000000000000',
        created_by: 'gm-1',
        kind: 'npc',
        name: 'Missing Game',
      }),
    ).rejects.toThrow('Cannot create a game entity for inactive game');
  });

  test('upserts unique stat/custom/inventory fields and constrains quantity', async () => {
    const game = await createGame();
    const entity = await entityDAO.create({
      game_id: game.id,
      created_by: 'gm-1',
      kind: 'creature',
      name: 'Dragon',
    });
    const template = await new StatTemplateDAO().create({
      game_id: game.id,
      stat_key: 'health',
      label: 'HP',
      field_type: 'number',
      default_value: '10',
      is_required: true,
      sort_order: 0,
    });

    await statDAO.create(entity.id, template.id, '20');
    await statDAO.create(entity.id, template.id, '25', { source: 'manual' });
    await customDAO.create(entity.id, 'Disposition', 'Hostile');
    await customDAO.create(entity.id, 'Disposition', 'Wary');
    const item = await inventoryDAO.create({
      gameEntityId: entity.id,
      name: 'Ancient Key',
      quantity: 2,
    });
    await inventoryFieldDAO.create(item.id, 'Material', 'Gold');
    await inventoryFieldDAO.create(item.id, 'Material', 'Brass');

    await expect(statDAO.findByGameEntity(entity.id)).resolves.toEqual([
      expect.objectContaining({ value: '25', meta: { source: 'manual' } }),
    ]);
    await expect(customDAO.findByGameEntity(entity.id)).resolves.toEqual([
      expect.objectContaining({ name: 'Disposition', value: 'Wary' }),
    ]);
    await expect(inventoryFieldDAO.findByInventory(item.id)).resolves.toEqual([
      expect.objectContaining({ name: 'Material', value: 'Brass' }),
    ]);
    await expect(
      inventoryDAO.create({ gameEntityId: entity.id, name: 'Impossible', quantity: 0 }),
    ).rejects.toThrow();
  });

  test('cascades child rows on entity, inventory, template, and game deletion', async () => {
    const game = await createGame();
    const entity = await entityDAO.create({
      game_id: game.id,
      created_by: 'gm-1',
      kind: 'npc',
      name: 'Archivist',
    });
    const template = await new StatTemplateDAO().create({
      game_id: game.id,
      stat_key: 'lore',
      label: 'Lore',
      field_type: 'short',
      default_value: '',
      is_required: false,
      sort_order: 0,
    });
    await statDAO.create(entity.id, template.id, 'Expert');
    await customDAO.create(entity.id, 'Secret', 'Yes');
    const item = await inventoryDAO.create({ gameEntityId: entity.id, name: 'Book' });
    await inventoryFieldDAO.create(item.id, 'Language', 'Draconic');

    await inventoryDAO.deleteById(item.id);
    await expect(inventoryFieldDAO.findByInventory(item.id)).resolves.toEqual([]);

    const secondItem = await inventoryDAO.create({ gameEntityId: entity.id, name: 'Map' });
    await inventoryFieldDAO.create(secondItem.id, 'Region', 'North');
    await query(`DELETE FROM stat_template WHERE id = $1`, [template.id]);
    await expect(statDAO.findByGameEntity(entity.id)).resolves.toEqual([]);

    await gameDAO.delete(game.id);
    await expect(entityDAO.findById(entity.id)).resolves.toBeNull();
    await expect(customDAO.findByGameEntity(entity.id)).resolves.toEqual([]);
    await expect(inventoryDAO.findByGameEntity(entity.id)).resolves.toEqual([]);
    await expect(inventoryFieldDAO.findByInventory(secondItem.id)).resolves.toEqual([]);
  });

  test('permanently cleans up only expired soft-deleted entities', async () => {
    const game = await createGame();
    const expired = await entityDAO.create({
      game_id: game.id,
      created_by: 'gm-1',
      kind: 'npc',
      name: 'Expired',
    });
    const recoverable = await entityDAO.create({
      game_id: game.id,
      created_by: 'gm-1',
      kind: 'npc',
      name: 'Recoverable',
    });
    await entityDAO.softDelete(expired.id);
    await entityDAO.softDelete(recoverable.id);
    await query(
      `UPDATE game_entity SET deleted_at = CURRENT_TIMESTAMP - INTERVAL '31 days' WHERE id = $1`,
      [expired.id],
    );

    await expect(entityDAO.findExpiredSoftDeletes(30)).resolves.toEqual([
      expect.objectContaining({ id: expired.id }),
    ]);
    await expect(entityDAO.deleteExpiredSoftDeletes(30)).resolves.toBe(1);
    await expect(entityDAO.findById(expired.id)).resolves.toBeNull();
    await expect(entityDAO.findById(recoverable.id)).resolves.toMatchObject({
      id: recoverable.id,
    });
  });
});
