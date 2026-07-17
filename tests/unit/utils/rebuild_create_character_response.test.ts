import type { APIStringSelectComponent } from 'discord.js';

import type { Game } from '../../../src/types/game';
import type { StatTemplate } from '../../../src/types/stat_template';
import { rebuildCreateCharacterResponse } from '../../../src/utils/rebuild_create_character_response';

const game = {
  id: 'game-1',
  name: 'Test Game',
  description: null,
  created_by: 'gm-1',
  guild_id: 'guild-1',
  is_public: false,
} as Game;

const statTemplates: StatTemplate[] = [
  {
    id: 'name-stat',
    game_id: 'game-1',
    label: 'NAME',
    field_type: 'short',
    default_value: null,
    is_required: true,
    sort_order: 0,
    meta: {},
  },
  {
    id: 'hp',
    game_id: 'game-1',
    label: 'HP',
    field_type: 'count',
    default_value: '4',
    is_required: true,
    sort_order: 1,
    meta: {},
  },
];

function createDropdownOptions(response: ReturnType<typeof rebuildCreateCharacterResponse>) {
  const row = response.components.find(
    (component) => component.toJSON().components[0]?.custom_id === 'createCharacterDropdown',
  );
  const dropdown = row?.toJSON().components[0] as APIStringSelectComponent | undefined;
  return dropdown?.options.map((option) => option.value) ?? [];
}

describe('rebuildCreateCharacterResponse', () => {
  test('keeps optional RP fields selectable after required fields are saved', () => {
    const response = rebuildCreateCharacterResponse(
      game,
      statTemplates,
      [{ name: 'backstory', label: 'Backstory' }],
      [{ name: 'game:name-stat', label: '[GAME] NAME' }],
      {
        'core:name': 'Kris',
        'core:avatar_url': 'https://example.com/avatar.png',
        'core:bio': 'A hero',
        'meta:game:hp': { max: 4, current: 4 },
      },
    );

    expect(createDropdownOptions(response)).toEqual([
      'core:rp_display_name|[CORE] RP Display Name',
      'core:rp_display_avatar_url|[CORE] RP Display Avatar URL',
      'game:name-stat|[GAME] NAME|short',
      'user:backstory|[USER] Backstory',
    ]);
    expect(response.content).toContain(
      'Optional RP Proxy and USER fields remain available until set.',
    );
    expect(response.components.at(-1)?.toJSON().components[0]).toEqual(
      expect.objectContaining({ custom_id: 'submitNewCharacter', disabled: true }),
    );
  });

  test('enables submission while leaving unfilled optional fields selectable', () => {
    const response = rebuildCreateCharacterResponse(game, [], [], [], {
      'core:name': 'Kris',
      'core:avatar_url': 'https://example.com/avatar.png',
      'core:bio': 'A hero',
    });

    expect(createDropdownOptions(response)).toEqual([
      'core:rp_display_name|[CORE] RP Display Name',
      'core:rp_display_avatar_url|[CORE] RP Display Avatar URL',
    ]);
    expect(response.content).toContain('All required fields are filled');
    expect(response.components.at(-1)?.toJSON().components[0]).toEqual(
      expect.objectContaining({ custom_id: 'submitNewCharacter', disabled: false }),
    );
  });
});
