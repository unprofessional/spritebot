import type { StringSelectMenuInteraction } from 'discord.js';

import { dispatchInteractionWithDeadline } from '../../../src/discord/interaction_dispatch';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import { preparedModalInteractionPolicy } from '../../../src/discord/prepared_modal';
import { resolvePreparedModalSubmission } from '../../../src/discord/prepared_modal';
import { getModalInteractionPolicy } from '../../../src/handlers/modal_handlers';
import { getButtonInteractionPolicy, handleButton } from '../../../src/handlers/button_handlers';
import {
  getSelectMenuInteractionPolicy,
  handleSelectMenu,
} from '../../../src/handlers/select_menu_handlers';
import { interactionPolicy } from '../../../src/handlers/select_menu_handlers/adjust_numeric_stat_select';
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

function selectInteraction() {
  return {
    customId: 'adjustStatSelect:character-1',
    values: ['stat:stat-hp'],
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

describe('numeric stat adjustment modal boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('declares the gated prepared component-modal policy at the live router', () => {
    expect(getSelectMenuInteractionPolicy('adjustStatSelect:character-1')).toBe(interactionPolicy);
    expect(interactionPolicy).toEqual({
      mode: { kind: 'modal-or-component-update' },
      acknowledgement: 'auto-defer',
      authorization: 'modal-submit',
    });
  });

  test('preserves the immediate adjustment modal on the fast path', async () => {
    getCharacterWithStatsMock.mockResolvedValue(character);
    const interaction = selectInteraction();

    await dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: interactionPolicy,
      handler: handleSelectMenu,
    });

    expect(getCharacterWithStatsMock).toHaveBeenCalledWith('character-1');
    expectAdjustmentModal(interaction.showModal as jest.Mock);
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();
  });

  test('preserves original-message not-found feedback on the fast path', async () => {
    getCharacterWithStatsMock.mockResolvedValue(null);
    const interaction = selectInteraction();
    const responder = new DiscordInteractionResponder(interaction, interactionPolicy.mode);

    await handleSelectMenu(interaction, responder);

    expect(interaction.update).toHaveBeenCalledWith({
      content: '❌ Character or stat not found.',
      embeds: [],
      components: [],
    });
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  test('delivers private owner activation after slow component deferral', async () => {
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

      expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
      resolveCharacter(character);
      await dispatch;

      expect(interaction.showModal).not.toHaveBeenCalled();
      expect(interaction.editReply).not.toHaveBeenCalled();
      const preparedPayload = (interaction.followUp as jest.Mock).mock.calls[0][0];
      expect(preparedPayload.content).toBe(
        'Discord needed a moment. Select **Open editor** to continue where you left off.',
      );
      expect(preparedPayload.ephemeral).toBe(true);
      const customId = preparedPayload.components[0].toJSON().components[0].custom_id;

      const activation = selectInteraction();
      activation.customId = customId;
      const responder = new DiscordInteractionResponder(
        activation,
        preparedModalInteractionPolicy.mode,
      );
      expect(getButtonInteractionPolicy(customId)).toBe(preparedModalInteractionPolicy);
      await handleButton(activation as never, responder);

      const preparedModal = expectSingleModal(activation.showModal as jest.Mock);
      expect(preparedModal.custom_id).toMatch(/^preparedSubmit:/);
      expect(preparedModal.title).toBe('Adjust Stat Value');

      const submission = modalSubmission(preparedModal.custom_id);
      const intruderSubmission = modalSubmission(preparedModal.custom_id);
      intruderSubmission.user = { id: 'user-2' };
      const intruderResolution = resolvePreparedModalSubmission(intruderSubmission as never);
      expect(intruderResolution.interaction.customId).toBe(preparedModal.custom_id);
      expect(intruderResolution.updateOriginal).toBeUndefined();

      const resolved = resolvePreparedModalSubmission(submission as never);
      expect(resolved.interaction.customId).toBe('adjustStatModal:character-1:stat-hp');
      const submissionPolicy = getModalInteractionPolicy(resolved.interaction);
      await dispatchInteractionWithDeadline({
        interaction: resolved.interaction,
        policy: submissionPolicy,
        preparedComponentUpdateTarget: resolved.updateOriginal,
        handler: async (_routed, submissionResponder) => {
          await submissionResponder.respond({
            content: '✅ Updated **Hit Points**.',
            embeds: [{ title: 'Mara' }],
            components: [{ type: 1 }],
          });
        },
      });

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '✅ Updated **Hit Points**.',
        embeds: [{ title: 'Mara' }],
        components: [{ type: 1 }],
      });
      expect(submission.deferUpdate).toHaveBeenCalledTimes(1);
      expect(submission.editReply).toHaveBeenCalledWith({
        content: '✅ Updated **Hit Points**.\n\nThe original message has been refreshed.',
        embeds: [],
        components: [],
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('edits original-message not-found feedback after slow component deferral', async () => {
    jest.useFakeTimers();
    let resolveCharacter!: (result: null) => void;
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

      expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
      resolveCharacter(null);
      await dispatch;

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ Character or stat not found.',
        embeds: [],
        components: [],
      });
      expect(interaction.followUp).not.toHaveBeenCalled();
      expect(interaction.showModal).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

function expectAdjustmentModal(showModal: jest.Mock): void {
  expect(showModal).toHaveBeenCalledTimes(1);
  const modal = showModal.mock.calls[0][0].toJSON();
  expect(modal).toEqual(
    expect.objectContaining({
      custom_id: 'adjustStatModal:character-1:stat-hp',
      title: 'Adjust Stat Value',
    }),
  );
  expect(
    modal.components.map(
      (row: { components: Array<{ custom_id: string }> }) => row.components[0].custom_id,
    ),
  ).toEqual(['deltaOperator', 'deltaValue']);
}

function expectSingleModal(showModal: jest.Mock) {
  expect(showModal).toHaveBeenCalledTimes(1);
  return showModal.mock.calls[0][0].toJSON();
}

function modalSubmission(customId: string) {
  return {
    ...selectInteraction(),
    customId,
    message: { id: 'prepared-activation-message' },
  };
}
