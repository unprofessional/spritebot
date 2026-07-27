import type {
  GameEntity,
  GameEntityKind,
  GameEntityVisibility,
} from '../../../src/types/game_entity';
import {
  buildGameEntityAutocompleteChoices,
  formatEntityChoiceName,
} from '../../../src/utils/game_entity_autocomplete';

function entity(
  id: string,
  name: string,
  kind: GameEntityKind = 'creature',
  visibility: GameEntityVisibility = 'public',
): GameEntity {
  return {
    id,
    game_id: 'game-1',
    created_by: 'gm-1',
    kind,
    name,
    avatar_url: null,
    rp_display_name: null,
    rp_display_avatar_url: null,
    bio: null,
    visibility,
    deleted_at: null,
    deleted_by_game: false,
    created_at: '2026-01-01T00:00:00.000Z',
    last_updated_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('game entity autocomplete ranking', () => {
  test('ranks exact, prefix, token-prefix, substring, and subsequence matches', () => {
    const choices = buildGameEntityAutocompleteChoices(
      [
        entity('5', 'Golem of Black Light in Night'),
        entity('3', 'Cave Goblin'),
        entity('2', 'Goblin King'),
        entity('1', 'Goblin'),
        entity('4', 'Hobgoblin'),
      ],
      'goblin',
    );

    expect(choices.map((choice) => choice.value)).toEqual(['1', '2', '3', '4', '5']);
  });

  test('matches case-insensitively, normalizes accents, and supports multi-token prefixes', () => {
    expect(
      buildGameEntityAutocompleteChoices(
        [entity('1', 'Élite Goblin Scout'), entity('2', 'Goblin Mage')],
        'ELI gob',
      ).map((choice) => choice.value),
    ).toEqual(['1']);
  });

  test('uses human context for duplicate names without exposing IDs', () => {
    const choices = buildGameEntityAutocompleteChoices(
      [
        entity('source-uuid-one', 'Goblin', 'npc', 'private'),
        entity('source-uuid-two', 'Goblin', 'creature', 'public'),
      ],
      'goblin',
    );

    expect(choices.map((choice) => choice.name)).toEqual([
      'Goblin — Creature • Public',
      'Goblin — NPC • Private',
    ]);
    expect(choices.map((choice) => choice.name).join(' ')).not.toContain('source-uuid');
  });

  test('adds deterministic human qualifiers when duplicate names share the same context', () => {
    const choices = buildGameEntityAutocompleteChoices(
      [
        entity('entity-b', 'Goblin', 'creature', 'public'),
        entity('entity-a', 'Goblin', 'creature', 'public'),
      ],
      'goblin',
    );

    expect(choices).toEqual([
      { name: 'Goblin — Creature • Public • 1', value: 'entity-a' },
      { name: 'Goblin — Creature • Public • 2', value: 'entity-b' },
    ]);
  });

  test('returns a deterministic alphabetical first page capped at 25 choices', () => {
    const entities = Array.from({ length: 30 }, (_, index) =>
      entity(String(index).padStart(2, '0'), `Creature ${String(29 - index).padStart(2, '0')}`),
    );
    const choices = buildGameEntityAutocompleteChoices(entities, '');

    expect(choices).toHaveLength(25);
    expect(choices[0]?.name).toContain('Creature 00');
    expect(choices[24]?.name).toContain('Creature 24');
  });

  test('keeps labels within Discord limits while preserving kind and visibility context', () => {
    const choiceName = formatEntityChoiceName(entity('1', 'G'.repeat(150), 'creature', 'private'));
    expect(choiceName).toHaveLength(100);
    expect(choiceName.endsWith(' — Creature • Private')).toBe(true);
  });
});
