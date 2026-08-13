import type { ModalSubmitInteraction } from 'discord.js';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import { handle } from '../../../src/handlers/modal_handlers/stat_calculator_modal';
import {
  getCharacterWithStats,
  updateStatMetaField,
} from '../../../src/services/character.service';

jest.mock('../../../src/services/character.service', () => ({
  getCharacterWithStats: jest.fn(),
  updateStat: jest.fn(),
  updateStatMetaField: jest.fn(),
}));
jest.mock('../../../src/utils/is_active_character', () => ({
  isActiveCharacter: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../src/components/view_character_card', () => ({
  build: jest.fn().mockReturnValue({ embeds: [{ title: 'Mara' }], components: [] }),
}));

const getCharacterMock = getCharacterWithStats as jest.MockedFunction<typeof getCharacterWithStats>;
const updateCountMock = updateStatMetaField as jest.MockedFunction<typeof updateStatMetaField>;

const character = {
  id: 'character-1',
  game_id: 'game-1',
  user_id: 'user-1',
  name: 'Mara',
  customFields: [],
  stats: [
    {
      template_id: 'stat-hp',
      label: 'HP',
      field_type: 'count',
      value: '',
      meta: { max: 20, current: 8 },
    },
  ],
};

describe('numeric stat calculator modal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCharacterMock.mockResolvedValue(character);
  });

  test.each([
    ['+', 3, 11],
    ['-', 3, 5],
    ['*', 3, 24],
    ['/', 3, 2],
  ])('applies selected operator %s', async (operator, operand, expected) => {
    const interaction = modalInteraction(operator, String(operand));
    const responder = new DiscordInteractionResponder(interaction, { kind: 'component-update' });

    await handle(interaction, responder);

    expect(updateCountMock).toHaveBeenCalledWith('character-1', 'stat-hp', 'current', expected);
    expect(interaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining(`8 ${operator} ${operand}`) }),
    );
  });

  test('rejects a crafted operator value', async () => {
    const interaction = modalInteraction('%', '2');
    const responder = new DiscordInteractionResponder(interaction, { kind: 'component-update' });

    await handle(interaction, responder);

    expect(updateCountMock).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid operator') }),
    );
  });

  test('preserves the current value when dividing by zero', async () => {
    const interaction = modalInteraction('/', '0');
    const responder = new DiscordInteractionResponder(interaction, { kind: 'component-update' });

    await handle(interaction, responder);

    expect(updateCountMock).toHaveBeenCalledWith('character-1', 'stat-hp', 'current', 8);
  });
});

function modalInteraction(operator: string, value: string): ModalSubmitInteraction {
  return {
    customId: 'adjustStatModal:character-1:stat-hp',
    user: { id: 'user-1' },
    guildId: 'guild-1',
    fields: {
      getStringSelectValues: jest.fn().mockReturnValue([operator]),
      getTextInputValue: jest.fn().mockReturnValue(value),
    },
    replied: false,
    deferred: false,
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
  } as unknown as ModalSubmitInteraction;
}
