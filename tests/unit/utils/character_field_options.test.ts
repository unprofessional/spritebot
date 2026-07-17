import type { CustomField } from '../../../src/types/field_input';
import type { StatTemplate } from '../../../src/types/stat_template';
import {
  buildCharacterFieldOptions,
  getUnfilledCharacterFieldOptions,
} from '../../../src/utils/character_field_options';

const statTemplates: StatTemplate[] = [
  {
    id: 'hp',
    game_id: 'game-1',
    label: 'HP',
    field_type: 'count',
    default_value: '4',
    is_required: true,
    sort_order: 0,
    meta: {},
  },
  {
    id: 'class',
    game_id: 'game-1',
    label: 'Class',
    field_type: 'short',
    default_value: null,
    is_required: true,
    sort_order: 1,
    meta: {},
  },
];

const userFields: CustomField[] = [{ name: 'backstory', label: 'Backstory' }];

describe('character field options', () => {
  test('keeps unfilled optional RP and user fields alongside required fields', () => {
    const fields = buildCharacterFieldOptions(statTemplates, userFields);
    const unfilled = getUnfilledCharacterFieldOptions(fields, {
      'core:name': 'Kris',
      'core:avatar_url': 'https://example.com/avatar.png',
      'core:bio': 'A hero',
      'meta:game:hp': { max: 4, current: 4 },
    });

    expect(unfilled.map((field) => field.name)).toEqual([
      'core:rp_display_name',
      'core:rp_display_avatar_url',
      'game:class',
      'user:backstory',
    ]);
  });

  test('removes optional fields from the create list once they are filled', () => {
    const fields = buildCharacterFieldOptions([], []);
    const unfilled = getUnfilledCharacterFieldOptions(fields, {
      'core:rp_display_name': 'Kris',
      'core:rp_display_avatar_url': 'https://example.com/rp.png',
    });

    expect(unfilled.map((field) => field.name)).not.toContain('core:rp_display_name');
    expect(unfilled.map((field) => field.name)).not.toContain('core:rp_display_avatar_url');
  });
});
