import { CharacterDAO } from '../../../src/dao/character.dao';
import { GameDAO } from '../../../src/dao/game.dao';
import {
  createItem,
  deleteItemForCharacter,
  getCharacterWithInventory,
  getInventory,
  updateItem,
} from '../../../src/services/inventory.service';

describe('inventory.service', () => {
  const characterDAO = new CharacterDAO();
  const gameDAO = new GameDAO();

  async function createCharacter() {
    const game = await gameDAO.create({
      name: 'Treasure Road',
      description: 'Item-heavy adventure',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });

    return characterDAO.create({
      user_id: 'player-1',
      game_id: game.id,
      name: 'Pockets Deepwell',
      bio: null,
      avatar_url: null,
    });
  }

  test('creates and hydrates inventory items with quantity and custom text fields', async () => {
    const character = await createCharacter();

    await createItem(character.id, {
      name: 'Potion',
      type: 'Consumable',
      description: 'Restores a little health.',
      quantity: 3,
      fields: {
        rarity: 'common',
        notes: { value: 'Sour cherry flavor', meta: { kind: 'text' } },
      },
    });

    await expect(getInventory(character.id)).resolves.toEqual([
      expect.objectContaining({
        name: 'Potion',
        type: 'Consumable',
        description: 'Restores a little health.',
        quantity: 3,
        equipped: false,
        fields: {
          rarity: 'common',
          notes: 'Sour cherry flavor',
        },
      }),
    ]);
  });

  test('hydrates inventory from the character view model', async () => {
    const character = await createCharacter();

    await createItem(character.id, {
      name: 'Lantern',
      quantity: 1,
    });

    await expect(getCharacterWithInventory(character.id)).resolves.toEqual(
      expect.objectContaining({
        id: character.id,
        game_id: character.game_id,
        name: 'Pockets Deepwell',
        inventory: [
          expect.objectContaining({
            name: 'Lantern',
            quantity: 1,
          }),
        ],
      }),
    );
  });

  test('updates an existing inventory item for its owning character', async () => {
    const character = await createCharacter();
    const item = await createItem(character.id, {
      name: 'Potion',
      type: 'Consumable',
      description: 'Restores a little health.',
      quantity: 3,
    });

    await expect(
      updateItem(character.id, item.id, {
        name: 'Hi-Potion',
        type: 'Medicine',
        description: 'Restores more health.',
        quantity: 2,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: item.id,
        name: 'Hi-Potion',
        type: 'Medicine',
        description: 'Restores more health.',
        quantity: 2,
      }),
    );

    await expect(getInventory(character.id)).resolves.toEqual([
      expect.objectContaining({
        id: item.id,
        name: 'Hi-Potion',
        quantity: 2,
      }),
    ]);
  });

  test('does not update an item through the wrong character id', async () => {
    const owner = await createCharacter();
    const other = await createCharacter();
    const item = await createItem(owner.id, {
      name: 'Map',
      quantity: 1,
    });

    await expect(
      updateItem(other.id, item.id, {
        name: 'Forged Map',
        quantity: 1,
      }),
    ).resolves.toBeNull();

    await expect(getInventory(owner.id)).resolves.toEqual([
      expect.objectContaining({
        name: 'Map',
      }),
    ]);
  });

  test('deletes an existing inventory item for its owning character', async () => {
    const character = await createCharacter();
    const item = await createItem(character.id, {
      name: 'Old Key',
      quantity: 1,
    });

    await expect(deleteItemForCharacter(character.id, item.id)).resolves.toBe(true);
    await expect(getInventory(character.id)).resolves.toEqual([]);
  });

  test('does not delete an item through the wrong character id', async () => {
    const owner = await createCharacter();
    const other = await createCharacter();
    const item = await createItem(owner.id, {
      name: 'Signed Letter',
      quantity: 1,
    });

    await expect(deleteItemForCharacter(other.id, item.id)).resolves.toBe(false);
    await expect(getInventory(owner.id)).resolves.toEqual([
      expect.objectContaining({
        name: 'Signed Letter',
      }),
    ]);
  });

  test('rejects invalid quantities before writing an item', async () => {
    const character = await createCharacter();

    await expect(
      createItem(character.id, {
        name: 'Broken Stack',
        quantity: 0,
      }),
    ).rejects.toThrow('positive integer');

    await expect(getInventory(character.id)).resolves.toEqual([]);
  });
});
