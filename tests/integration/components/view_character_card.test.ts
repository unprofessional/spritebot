import { build } from '../../../src/components/view_character_card';
import type { CharacterWithStats } from '../../../src/types/character';

function character(overrides: Partial<CharacterWithStats> = {}): CharacterWithStats {
  return {
    id: 'character-1',
    game_id: 'game-1',
    user_id: 'user-1',
    name: 'Pockets Deepwell',
    bio: 'Has too many bags.',
    visibility: 'public',
    created_at: '2026-01-01T00:00:00.000Z',
    stats: [],
    customFields: [],
    ...overrides,
  };
}

describe('view_character_card', () => {
  test('renders equipped inventory items at the end of the character sheet', () => {
    const view = build(
      character({
        inventory: [
          {
            id: 'item-1',
            name: 'Moonlit Rapier',
            type: 'Weapon',
            description: 'A very long description that belongs in inventory detail.',
            quantity: 1,
            equipped: true,
          },
          {
            id: 'item-2',
            name: 'Throwing Knife',
            type: 'Weapon',
            description: 'Sharp.',
            quantity: 3,
            equipped: true,
          },
          {
            id: 'item-3',
            name: 'Bedroll',
            type: 'Gear',
            description: 'Definitely not equipped.',
            quantity: 1,
            equipped: false,
          },
        ],
      }),
    );

    const fields = view.embeds[0].data.fields ?? [];
    const equippedField = fields.find((field) => field.name === 'Equipped Items');

    expect(equippedField?.value).toContain('**Moonlit Rapier** _(Weapon)_');
    expect(equippedField?.value).toContain('**Throwing Knife** x3 _(Weapon)_');
    expect(equippedField?.value).not.toContain('Bedroll');
    expect(equippedField?.value).not.toContain('A very long description');
    expect(fields[fields.length - 1]?.name).toBe('Equipped Items');
  });

  test('omits equipped inventory section when no items are equipped', () => {
    const view = build(
      character({
        inventory: [
          {
            id: 'item-1',
            name: 'Lantern',
            type: 'Gear',
            description: null,
            quantity: 1,
            equipped: false,
          },
        ],
      }),
    );

    const fields = view.embeds[0].data.fields ?? [];

    expect(fields.some((field) => field.name === 'Equipped Items')).toBe(false);
  });
});
