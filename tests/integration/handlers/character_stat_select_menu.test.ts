import type { StringSelectMenuInteraction } from 'discord.js';

import { dispatchInteractionWithDeadline } from '../../../src/discord/interaction_dispatch';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import { preparedModalInteractionPolicy } from '../../../src/discord/prepared_modal';
import { getButtonInteractionPolicy, handleButton } from '../../../src/handlers/button_handlers';
import {
  getSelectMenuInteractionPolicy,
  handleSelectMenu,
} from '../../../src/handlers/select_menu_handlers';
import { interactionPolicy } from '../../../src/handlers/select_menu_handlers/character_stat_select_menu';
import { getCharacterWithStats } from '../../../src/services/character.service';

jest.mock('../../../src/services/character.service', () => ({
  ...jest.requireActual('../../../src/services/character.service'),
  getCharacterWithStats: jest.fn(),
}));

const getCharacterWithStatsMock = getCharacterWithStats as jest.MockedFunction<
  typeof getCharacterWithStats
>;

const character = {
  id: 'character-1',
  game_id: 'game-1',
  user_id: 'user-1',
  name: 'Mara',
  bio: 'Original biography',
  customFields: [],
  stats: [
    {
      template_id: 'stat-hp',
      label: 'Hit Points',
      field_type: 'count',
      value: '',
      meta: { max: 12, current: 8 },
    },
  ],
};

function selectInteraction(values = ['stat-hp']) {
  return {
    customId: 'editCharacterStatDropdown:character-1',
    values,
    user: { id: 'user-1' },
    replied: false,
    deferred: false,
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    showModal: jest.fn().mockResolvedValue(undefined),
  } as unknown as StringSelectMenuInteraction;
}

describe('character stat select prepared-modal boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('declares the gated prepared-modal policy at the live router', () => {
    expect(getSelectMenuInteractionPolicy('editCharacterStatDropdown:character-1')).toBe(
      interactionPolicy,
    );
    expect(interactionPolicy).toEqual({
      mode: { kind: 'modal-or-reply', visibility: 'ephemeral' },
      acknowledgement: 'auto-defer',
      authorization: 'modal-submit',
    });
  });

  test('preserves the prefilled core-field editor on the fast path', async () => {
    getCharacterWithStatsMock.mockResolvedValue(character);
    const interaction = selectInteraction(['core:bio']);

    await dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: interactionPolicy,
      handler: handleSelectMenu,
    });

    expect(getCharacterWithStatsMock).toHaveBeenCalledWith('character-1');
    const modal = expectSingleModal(interaction.showModal as jest.Mock);
    expect(modal).toEqual(
      expect.objectContaining({
        custom_id: 'editCharacterField:character-1:core:bio',
        title: 'Edit Bio',
      }),
    );
    expect(modal.components[0].components[0]).toEqual(
      expect.objectContaining({
        custom_id: 'core:bio',
        label: 'Value for Bio',
        style: 2,
        value: 'Original biography',
      }),
    );
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test('preserves the prefilled count-stat editor on the fast path', async () => {
    getCharacterWithStatsMock.mockResolvedValue(character);
    const interaction = selectInteraction();

    await dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: interactionPolicy,
      handler: handleSelectMenu,
    });

    const modal = expectSingleModal(interaction.showModal as jest.Mock);
    expect(modal).toEqual(
      expect.objectContaining({
        custom_id: 'editStatModal:character-1:count:stat-hp',
        title: 'Edit Stat: Hit Points',
      }),
    );
    expect(
      modal.components.map(
        (row: { components: Array<{ custom_id: string; value: string }> }) => row.components[0],
      ),
    ).toEqual([
      expect.objectContaining({ custom_id: 'stat-hp:max', value: '12' }),
      expect.objectContaining({ custom_id: 'stat-hp:current', value: '8' }),
    ]);
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test('preserves the same count-stat editor behind owner activation on the slow path', async () => {
    jest.useFakeTimers();
    let resolveCharacter!: (result: typeof character) => void;
    getCharacterWithStatsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCharacter = resolve;
      }),
    );

    try {
      const interaction = selectInteraction();
      const dispatch = dispatchInteractionWithDeadline({
        interaction: interaction as never,
        policy: interactionPolicy,
        acknowledgementBudgetMs: 10,
        handler: handleSelectMenu,
      });
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(10);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      resolveCharacter(character);
      await dispatch;

      expect(interaction.showModal).not.toHaveBeenCalled();
      const preparedPayload = (interaction.editReply as jest.Mock).mock.calls[0][0];
      expect(preparedPayload.content).toBe(
        'Discord needed a moment. Select **Open editor** to continue where you left off.',
      );
      const customId = preparedPayload.components[0].toJSON().components[0].custom_id;

      const activation = selectInteraction();
      activation.customId = customId;
      const responder = new DiscordInteractionResponder(
        activation,
        preparedModalInteractionPolicy.mode,
      );
      expect(getButtonInteractionPolicy(customId)).toBe(preparedModalInteractionPolicy);
      await handleButton(activation as never, responder);

      const modal = expectSingleModal(activation.showModal as jest.Mock);
      expect(modal.custom_id).toBe('editStatModal:character-1:count:stat-hp');
      expect(modal.components[0].components[0]).toEqual(
        expect.objectContaining({ custom_id: 'stat-hp:max', value: '12' }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test.each([
    [[], null, '⚠️ No stat selected.'],
    [['stat-hp'], null, '❌ Character not found.'],
    [['missing-stat'], character, '❌ Could not find that stat field.'],
  ])('preserves ephemeral validation for values %j', async (values, result, content) => {
    getCharacterWithStatsMock.mockResolvedValue(result);
    const interaction = selectInteraction(values);
    const responder = new DiscordInteractionResponder(interaction, interactionPolicy.mode);

    await handleSelectMenu(interaction, responder);

    expect(interaction.reply).toHaveBeenCalledWith({ content, ephemeral: true });
    expect(interaction.showModal).not.toHaveBeenCalled();
  });
});

function expectSingleModal(showModal: jest.Mock) {
  expect(showModal).toHaveBeenCalledTimes(1);
  return showModal.mock.calls[0][0].toJSON();
}
