import type { ButtonInteraction } from 'discord.js';

import { dispatchInteractionWithDeadline } from '../../../src/discord/interaction_dispatch';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import { preparedModalInteractionPolicy } from '../../../src/discord/prepared_modal';
import { getButtonInteractionPolicy, handleButton } from '../../../src/handlers/button_handlers';
import { interactionPolicy } from '../../../src/handlers/button_handlers/inventory_buttons';
import { belongsToUser } from '../../../src/services/character.service';
import { getItemForCharacter } from '../../../src/services/inventory.service';

jest.mock('../../../src/services/character.service', () => ({
  ...jest.requireActual('../../../src/services/character.service'),
  belongsToUser: jest.fn(),
}));

jest.mock('../../../src/services/inventory.service', () => ({
  ...jest.requireActual('../../../src/services/inventory.service'),
  getItemForCharacter: jest.fn(),
}));

const belongsToUserMock = belongsToUser as jest.MockedFunction<typeof belongsToUser>;
const getItemForCharacterMock = getItemForCharacter as jest.MockedFunction<
  typeof getItemForCharacter
>;

const item = {
  id: 'item-1',
  character_id: 'character-1',
  name: 'Healing Potion',
  type: 'Consumable',
  description: 'Restores health.',
  quantity: 3,
  equipped: false,
  sort_order: 0,
};

function buttonInteraction(customId: string) {
  return {
    customId,
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
  } as unknown as ButtonInteraction;
}

describe('inventory button prepared-modal boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('declares the prepared modal policy only for inventory modal-opening buttons', () => {
    expect(getButtonInteractionPolicy('add_inventory_item:character-1:0')).toBe(interactionPolicy);
    expect(getButtonInteractionPolicy('invEdit:character-1:item-1:0')).toBe(interactionPolicy);
    expect(getButtonInteractionPolicy('edit_inventory_item:character-1:item-1:0')).toBe(
      interactionPolicy,
    );
    expect(interactionPolicy).toEqual({
      mode: { kind: 'modal-or-reply', visibility: 'ephemeral' },
      acknowledgement: 'auto-defer',
      authorization: 'modal-submit',
    });
    expect(getButtonInteractionPolicy('inventoryPage:next:character-1:0')).toBeUndefined();
  });

  test('preserves the immediate add-item modal on the fast path', async () => {
    belongsToUserMock.mockResolvedValue(true);
    const interaction = buttonInteraction('add_inventory_item:character-1:2');

    await dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: interactionPolicy,
      handler: handleButton,
    });

    expect(belongsToUserMock).toHaveBeenCalledWith('character-1', 'user-1');
    expectAddModal(interaction.showModal as jest.Mock);
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test('preserves immediate ownership denial before opening an add modal', async () => {
    belongsToUserMock.mockResolvedValue(false);
    const interaction = buttonInteraction('add_inventory_item:character-1:0');

    await dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: interactionPolicy,
      handler: handleButton,
    });

    expect(interaction.reply).toHaveBeenCalledWith({
      content: '❌ You can only manage inventory for your own characters.',
      ephemeral: true,
    });
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  test('preserves the prefilled edit-item modal on the fast path', async () => {
    belongsToUserMock.mockResolvedValue(true);
    getItemForCharacterMock.mockResolvedValue(item);
    const interaction = buttonInteraction('invEdit:character-1:item-1:2');

    await dispatchInteractionWithDeadline({
      interaction: interaction as never,
      policy: interactionPolicy,
      handler: handleButton,
    });

    expect(getItemForCharacterMock).toHaveBeenCalledWith('character-1', 'item-1');
    expectEditModal(interaction.showModal as jest.Mock);
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test.each([
    ['add_inventory_item:character-1:2', 'add'],
    ['invEdit:character-1:item-1:2', 'edit'],
  ])(
    'preserves the %s modal behind owner activation after slow ownership lookup',
    async (customId, kind) => {
      jest.useFakeTimers();
      let resolveOwnership!: (ownsCharacter: boolean) => void;
      belongsToUserMock.mockReturnValue(
        new Promise((resolve) => {
          resolveOwnership = resolve;
        }),
      );
      getItemForCharacterMock.mockResolvedValue(item);

      try {
        const interaction = buttonInteraction(customId);
        const dispatch = dispatchInteractionWithDeadline({
          interaction: interaction as never,
          policy: interactionPolicy,
          acknowledgementBudgetMs: 10,
          handler: handleButton,
        });
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(10);

        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
        resolveOwnership(true);
        await dispatch;

        expect(interaction.showModal).not.toHaveBeenCalled();
        const preparedPayload = (interaction.editReply as jest.Mock).mock.calls[0][0];
        expect(preparedPayload.content).toBe(
          'Discord needed a moment. Select **Open editor** to continue where you left off.',
        );
        const preparedCustomId = preparedPayload.components[0].toJSON().components[0].custom_id;

        const activation = buttonInteraction(preparedCustomId);
        const activationResponder = new DiscordInteractionResponder(
          activation,
          preparedModalInteractionPolicy.mode,
        );
        expect(getButtonInteractionPolicy(preparedCustomId)).toBe(preparedModalInteractionPolicy);
        await handleButton(activation, activationResponder);

        if (kind === 'add') expectAddModal(activation.showModal as jest.Mock);
        else expectEditModal(activation.showModal as jest.Mock);
      } finally {
        jest.useRealTimers();
      }
    },
  );
});

function expectAddModal(showModal: jest.Mock): void {
  expect(showModal).toHaveBeenCalledTimes(1);
  const modal = showModal.mock.calls[0][0].toJSON();
  expect(modal).toEqual(
    expect.objectContaining({
      custom_id: 'addInventoryModal:character-1:2',
      title: 'Add Inventory Item',
    }),
  );
  expect(
    modal.components.map(
      (row: { components: Array<{ custom_id: string }> }) => row.components[0].custom_id,
    ),
  ).toEqual(['name', 'type', 'quantity', 'description']);
}

function expectEditModal(showModal: jest.Mock): void {
  expect(showModal).toHaveBeenCalledTimes(1);
  const modal = showModal.mock.calls[0][0].toJSON();
  expect(modal).toEqual(
    expect.objectContaining({
      custom_id: 'editInventoryModal:character-1:item-1:2',
      title: 'Edit Healing Potion',
    }),
  );
  expect(
    modal.components.map(
      (row: { components: Array<{ custom_id: string; value: string }> }) => row.components[0],
    ),
  ).toEqual([
    expect.objectContaining({ custom_id: 'name', value: 'Healing Potion' }),
    expect.objectContaining({ custom_id: 'type', value: 'Consumable' }),
    expect.objectContaining({ custom_id: 'quantity', value: '3' }),
    expect.objectContaining({ custom_id: 'description', value: 'Restores health.' }),
  ]);
}
