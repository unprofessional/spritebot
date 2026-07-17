import type { APIStringSelectComponent, ButtonInteraction } from 'discord.js';

import { handle as handleCalculateCharacterStats } from '../../../src/components/calculate_character_stats_button';
import { handle } from '../../../src/components/edit_character_stats_button';
import type { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import { getCharacterWithStats } from '../../../src/services/character.service';
import type { CharacterWithStats } from '../../../src/types/character';
import { isActiveCharacter } from '../../../src/utils/is_active_character';

jest.mock('../../../src/services/character.service', () => ({
  getCharacterWithStats: jest.fn(),
}));
jest.mock('../../../src/utils/is_active_character', () => ({
  isActiveCharacter: jest.fn(),
}));

const getCharacterWithStatsMock = getCharacterWithStats as jest.MockedFunction<
  typeof getCharacterWithStats
>;
const isActiveCharacterMock = isActiveCharacter as jest.MockedFunction<typeof isActiveCharacter>;

describe('edit character stats dropdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isActiveCharacterMock.mockResolvedValue(true);
  });

  test('shows count values using the shared current/max format', async () => {
    getCharacterWithStatsMock.mockResolvedValue(character());
    const response = responder();

    await handle(interaction(), response);

    const payload = (response.respond as jest.Mock).mock.calls[0][0];
    const dropdown = payload.components[0].toJSON().components[0] as APIStringSelectComponent;
    const descriptions = Object.fromEntries(
      dropdown.options.map((option) => [option.label, option.description]),
    );

    expect(descriptions.HP).toBe('Current: 8 / 12');
    expect(descriptions.MP).toBe('Current: 4 / 4');
    expect(descriptions.Class).toBe('Current: Wizard');
  });

  test('shows the same count values in the quick-math dropdown', async () => {
    getCharacterWithStatsMock.mockResolvedValue(character());
    const response = responder();

    await handleCalculateCharacterStats(
      interaction('calculateCharacterStats:character-1'),
      response,
    );

    const payload = (response.respond as jest.Mock).mock.calls[0][0];
    const dropdown = payload.components[0].toJSON().components[0] as APIStringSelectComponent;
    const descriptions = Object.fromEntries(
      dropdown.options.map((option) => [option.label, option.description]),
    );

    expect(descriptions.HP).toBe('Current: 8 / 12');
    expect(descriptions.MP).toBe('Current: 4 / 4');
  });
});

function character(): CharacterWithStats {
  return {
    id: 'character-1',
    game_id: 'game-1',
    user_id: 'user-1',
    name: 'Mara',
    visibility: 'private',
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
      {
        template_id: 'class',
        label: 'Class',
        field_type: 'short',
        value: 'Wizard',
        meta: {},
      },
    ],
    customFields: [],
  };
}

function interaction(customId = 'editCharacterStat:character-1'): ButtonInteraction {
  return {
    customId,
    user: { id: 'user-1' },
    guildId: 'guild-1',
  } as unknown as ButtonInteraction;
}

function responder(): DiscordInteractionResponder {
  return {
    respond: jest.fn().mockResolvedValue(undefined),
  } as unknown as DiscordInteractionResponder;
}
