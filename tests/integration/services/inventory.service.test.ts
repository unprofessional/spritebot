import { CharacterDAO } from '../../../src/dao/character.dao';
import { GameDAO } from '../../../src/dao/game.dao';
import {
  createItem,
  getCharacterWithInventory,
  getInventory,
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
