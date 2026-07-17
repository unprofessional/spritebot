import type { APIStringSelectComponent } from 'discord.js';

import { rebuildListCharactersResponse } from '../../../src/components/rebuild_list_characters_response';
import { build as buildSwitchCharacterSelector } from '../../../src/components/switch_character_selector';
import {
  getCharactersByUser,
  getCharacterWithStats,
} from '../../../src/services/character.service';
import { getCurrentCharacter, getCurrentGame } from '../../../src/services/player.service';
import type { CharacterWithStats } from '../../../src/types/character';
import { validateGameAccess } from '../../../src/utils/validate_game_access';

jest.mock('../../../src/services/character.service', () => ({
  getCharactersByUser: jest.fn(),
  getCharacterWithStats: jest.fn(),
}));
jest.mock('../../../src/services/player.service', () => ({
  getCurrentCharacter: jest.fn(),
  getCurrentGame: jest.fn(),
}));
jest.mock('../../../src/utils/validate_game_access', () => ({
  validateGameAccess: jest.fn(),
}));

const getCharactersByUserMock = getCharactersByUser as jest.MockedFunction<
  typeof getCharactersByUser
>;
const getCharacterWithStatsMock = getCharacterWithStats as jest.MockedFunction<
  typeof getCharacterWithStats
>;
const getCurrentCharacterMock = getCurrentCharacter as jest.MockedFunction<
  typeof getCurrentCharacter
>;
const getCurrentGameMock = getCurrentGame as jest.MockedFunction<typeof getCurrentGame>;
const validateGameAccessMock = validateGameAccess as jest.MockedFunction<typeof validateGameAccess>;

describe('character selector stat summaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const fullCharacter = character();
    getCurrentGameMock.mockResolvedValue('game-1');
    getCurrentCharacterMock.mockResolvedValue('character-1');
    getCharactersByUserMock.mockResolvedValue([fullCharacter]);
    getCharacterWithStatsMock.mockResolvedValue(fullCharacter);
    validateGameAccessMock.mockResolvedValue({ valid: true });
  });

  test('formats count values in the switch-character dropdown', async () => {
    const response = await buildSwitchCharacterSelector('user-1', 'guild-1');
    expect('components' in response).toBe(true);

    const dropdown = response.components[0].toJSON().components[0] as APIStringSelectComponent;
    expect(dropdown.options[0].description).toContain('HP: 8 / 12');
    expect(dropdown.options[0].description).toContain('MP: 4 / 4');
  });

  test('formats count values in the public-character dropdown', async () => {
    const response = await rebuildListCharactersResponse(
      [
        {
          id: 'character-1',
          name: 'Mara',
          created_at: '2026-01-01T00:00:00.000Z',
          visibility: 'public',
        },
      ],
      0,
      'user-1',
      'guild-1',
    );

    const dropdown = response.components[0].toJSON().components[0] as APIStringSelectComponent;
    expect(dropdown.options[0].description).toContain('HP: 8 / 12');
    expect(dropdown.options[0].description).toContain('MP: 4 / 4');
  });
});

function character(): CharacterWithStats {
  return {
    id: 'character-1',
    game_id: 'game-1',
    user_id: 'user-1',
    name: 'Mara',
    visibility: 'public',
    created_at: '2026-01-01T00:00:00.000Z',
    stats: [
      {
        template_id: 'hp',
        label: 'HP',
        field_type: 'count',
        value: '',
        meta: { current: 8, max: 12 },
      },
      {
        template_id: 'mp',
        label: 'MP',
        field_type: 'count',
        value: '',
        meta: { max: 4 },
      },
    ],
    customFields: [],
  };
}
