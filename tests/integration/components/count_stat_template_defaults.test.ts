import type { ModalSubmitInteraction } from 'discord.js';

import { handle as handleCreateStat } from '../../../src/components/create_stat_modal';
import type { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import { handle as handleEditStat } from '../../../src/handlers/modal_handlers/stat_template_modals';
import {
  addStatTemplates,
  getGame,
  getStatTemplateById,
  getStatTemplates,
  updateStatTemplate,
} from '../../../src/services/game.service';
import type { StatTemplate } from '../../../src/types/stat_template';

jest.mock('../../../src/services/game.service', () => ({
  addStatTemplates: jest.fn(),
  getGame: jest.fn(),
  getStatTemplateById: jest.fn(),
  getStatTemplates: jest.fn(),
  updateStatTemplate: jest.fn(),
}));

const addStatTemplatesMock = addStatTemplates as jest.MockedFunction<typeof addStatTemplates>;
const getGameMock = getGame as jest.MockedFunction<typeof getGame>;
const getStatTemplateByIdMock = getStatTemplateById as jest.MockedFunction<
  typeof getStatTemplateById
>;
const getStatTemplatesMock = getStatTemplates as jest.MockedFunction<typeof getStatTemplates>;
const updateStatTemplateMock = updateStatTemplate as jest.MockedFunction<typeof updateStatTemplate>;

const game = {
  id: 'game-1',
  guild_id: 'guild-1',
  name: 'Test Game',
  description: null,
  is_public: false,
  created_by: 'user-1',
};

const countTemplate: StatTemplate = {
  id: 'stat-1',
  game_id: 'game-1',
  stat_key: 'hp',
  label: 'HP',
  field_type: 'count',
  default_value: '10',
  is_required: true,
  sort_order: 1,
  meta: { default_current: 4, note: 'preserve' },
};

function modalInteraction(customId: string, values: Record<string, string>, userId = 'user-1') {
  return {
    customId,
    user: { id: userId },
    guildId: 'guild-1',
    fields: {
      getTextInputValue: jest.fn((id: string) => values[id] ?? ''),
    },
  } as unknown as ModalSubmitInteraction;
}

function responder() {
  return {
    respond: jest.fn().mockResolvedValue(undefined),
  } as unknown as DiscordInteractionResponder;
}

describe('count stat template defaults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getGameMock.mockResolvedValue(game);
    getStatTemplatesMock.mockResolvedValue([countTemplate]);
  });

  test('persists max and current defaults when creating a count template', async () => {
    const interaction = modalInteraction('createStatModal:game-1:count', {
      label: 'hp',
      stat_key: 'hp',
      default_value: '10',
      default_current: '4',
      sort_index: '1',
    });

    await handleCreateStat(interaction, responder());

    expect(addStatTemplatesMock).toHaveBeenCalledWith('game-1', [
      {
        stat_key: 'hp',
        label: 'HP',
        field_type: 'count',
        default_value: '10',
        sort_order: 1,
        meta: { default_current: 4 },
      },
    ]);
  });

  test('updates count defaults while preserving unrelated template metadata', async () => {
    getStatTemplateByIdMock.mockResolvedValue(countTemplate);
    const interaction = modalInteraction('editStatTemplateModal:stat-1', {
      label: 'health',
      default_value: '12',
      default_current: '6',
      sort_order: '2',
    });

    await handleEditStat(interaction, responder());

    expect(updateStatTemplateMock).toHaveBeenCalledWith('stat-1', {
      label: 'HEALTH',
      default_value: '12',
      sort_order: 2,
      meta: { default_current: 6, note: 'preserve' },
    });
  });

  test('rejects a current default without a max default', async () => {
    const interaction = modalInteraction('createStatModal:game-1:count', {
      label: 'hp',
      stat_key: 'hp',
      default_current: '4',
      sort_index: '1',
    });
    const response = responder();

    await handleCreateStat(interaction, response);

    expect(addStatTemplatesMock).not.toHaveBeenCalled();
    expect(response.respond).toHaveBeenCalledWith({
      content: '⚠️ Set a default MAX value before setting a default CURRENT value.',
      ephemeral: true,
    });
  });

  test('revalidates game ownership before creating a custom stat', async () => {
    const interaction = modalInteraction(
      'createStatModal:game-1:number',
      {
        label: 'Stress',
        stat_key: 'stress',
      },
      'other-user',
    );
    const response = responder();

    await handleCreateStat(interaction, response);

    expect(addStatTemplatesMock).not.toHaveBeenCalled();
    expect(response.respond).toHaveBeenCalledWith({
      content: '⚠️ Only the GM can create custom-stat definitions for this game.',
      ephemeral: true,
    });
  });
});
