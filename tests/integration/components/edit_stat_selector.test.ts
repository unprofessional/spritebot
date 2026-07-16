import type { StringSelectMenuInteraction } from 'discord.js';

import { interactionPolicy } from '../../../src/components/edit_stat_selector';
import { dispatchInteractionWithDeadline } from '../../../src/discord/interaction_dispatch';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import { preparedModalInteractionPolicy } from '../../../src/discord/prepared_modal';
import { getButtonInteractionPolicy, handleButton } from '../../../src/handlers/button_handlers';
import {
  getSelectMenuInteractionPolicy,
  handleSelectMenu,
} from '../../../src/handlers/select_menu_handlers';
import { getStatTemplates } from '../../../src/services/game.service';

jest.mock('../../../src/services/game.service', () => ({
  ...jest.requireActual('../../../src/services/game.service'),
  getStatTemplates: jest.fn(),
}));

const getStatTemplatesMock = getStatTemplates as jest.MockedFunction<typeof getStatTemplates>;

const field = {
  id: 'stat-1',
  game_id: 'game-1',
  label: 'Hit Points',
  field_type: 'count' as const,
  default_value: '10',
  is_required: true,
  sort_order: 2,
  meta: { default_current: 4 },
};

function selectInteraction(values = ['stat-1']) {
  return {
    customId: 'editStatSelect:game-1',
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

describe('edit stat selector prepared-modal boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('preserves the prefilled stat-template editor on the fast path', async () => {
    getStatTemplatesMock.mockResolvedValue([field]);
    const interaction = selectInteraction();
    const policy = getSelectMenuInteractionPolicy(interaction.customId);

    expect(policy).toBe(interactionPolicy);
    expect(policy).toEqual({
      mode: { kind: 'modal-or-component-update' },
      acknowledgement: 'auto-defer',
      authorization: 'modal-submit',
    });
    await dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: policy!,
      handler: handleSelectMenu,
    });

    expect(getStatTemplatesMock).toHaveBeenCalledWith('game-1');
    expectEditModal(interaction.showModal as jest.Mock);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test('preserves the prefilled editor behind owner activation on the slow path', async () => {
    jest.useFakeTimers();
    let resolveTemplates!: (templates: [typeof field]) => void;
    getStatTemplatesMock.mockReturnValue(
      new Promise((resolve) => {
        resolveTemplates = resolve;
      }),
    );

    try {
      const interaction = selectInteraction();
      const policy = getSelectMenuInteractionPolicy(interaction.customId)!;
      const dispatch = dispatchInteractionWithDeadline({
        interaction: interaction as never,
        policy,
        acknowledgementBudgetMs: 10,
        handler: handleSelectMenu,
      });
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(10);

      expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
      resolveTemplates([field]);
      await dispatch;

      expect(interaction.showModal).not.toHaveBeenCalled();
      const preparedPayload = (interaction.followUp as jest.Mock).mock.calls[0][0];
      expect(preparedPayload.content).toBe(
        'Discord needed a moment. Select **Open editor** to continue where you left off.',
      );
      const customId = preparedPayload.components[0].toJSON().components[0].custom_id;
      expect(customId).toMatch(/^preparedModal:/);

      const activation = selectInteraction();
      activation.customId = customId;
      const activationResponder = new DiscordInteractionResponder(
        activation,
        preparedModalInteractionPolicy.mode,
      );
      expect(getButtonInteractionPolicy(customId)).toBe(preparedModalInteractionPolicy);
      await handleButton(activation as never, activationResponder);

      expect(activation.showModal).toHaveBeenCalledTimes(1);
      expect((activation.showModal as jest.Mock).mock.calls[0][0].toJSON()).toEqual(
        expect.objectContaining({
          custom_id: expect.stringMatching(/^preparedSubmit:/),
          title: 'Edit Field: Hit Points',
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test('preserves immediate ephemeral validation without loading templates', async () => {
    const interaction = selectInteraction([]);
    const responder = new DiscordInteractionResponder(interaction, interactionPolicy.mode);

    await handleSelectMenu(interaction, responder);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: '⚠️ No field selected.',
      ephemeral: true,
    });
    expect(getStatTemplatesMock).not.toHaveBeenCalled();
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  test('preserves missing-field feedback after preparation', async () => {
    getStatTemplatesMock.mockResolvedValue([]);
    const interaction = selectInteraction();
    const responder = new DiscordInteractionResponder(interaction, interactionPolicy.mode);

    await handleSelectMenu(interaction, responder);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: '❌ Could not find that stat field.',
      ephemeral: true,
    });
    expect(interaction.showModal).not.toHaveBeenCalled();
  });
});

function expectEditModal(showModal: jest.Mock): void {
  expect(showModal).toHaveBeenCalledTimes(1);
  const modal = showModal.mock.calls[0][0].toJSON();
  expect(modal).toEqual(
    expect.objectContaining({
      custom_id: 'editStatTemplateModal:stat-1',
      title: 'Edit Field: Hit Points',
    }),
  );
  expect(
    modal.components.map(
      (row: { components: Array<{ custom_id: string; value: string }> }) => row.components[0],
    ),
  ).toEqual([
    expect.objectContaining({ custom_id: 'label', value: 'Hit Points' }),
    expect.objectContaining({ custom_id: 'default_value', value: '10' }),
    expect.objectContaining({ custom_id: 'default_current', value: '4' }),
    expect.objectContaining({ custom_id: 'sort_order', value: '2' }),
  ]);
}
