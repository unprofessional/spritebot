import type { ModalSubmitInteraction } from 'discord.js';

import { getButtonInteractionPolicy } from '../../../src/handlers/button_handlers';
import { getModalInteractionPolicy } from '../../../src/handlers/modal_handlers';
import { getSelectMenuInteractionPolicy } from '../../../src/handlers/select_menu_handlers';

const componentUpdatePolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
};

const ephemeralReplyPolicy = {
  mode: { kind: 'reply', visibility: 'ephemeral' },
  acknowledgement: 'auto-defer',
};

describe('remaining Task 7 interaction policies', () => {
  test.each([
    'calculateCharacterStats:character-1',
    'defineStats:game-1',
    'deleteCharacter:character-1',
    'deleteGame:game-1',
    'confirmDeleteGame:game-1',
    'cancelDeleteGame:game-1',
    'deleteStats:game-1',
    'editCharacterStat:character-1',
    'editGameStats:game-1',
  ])('routes button %s through component update auto-deferral', (customId) => {
    expect(getButtonInteractionPolicy(customId)).toEqual(componentUpdatePolicy);
  });

  test('routes the delete-stat selector through component update auto-deferral', () => {
    expect(getSelectMenuInteractionPolicy('deleteStatSelect:game-1')).toEqual(
      componentUpdatePolicy,
    );
  });

  test('routes the restore-game selector through component update auto-deferral', () => {
    expect(getSelectMenuInteractionPolicy('restoreGameDropdown')).toEqual(componentUpdatePolicy);
  });

  test.each([
    'createStatModal:game-1:count',
    'createDraftCharacterField:core:name|Name|short',
    'setCharacterField:character-1:core:name|Name|short',
    'editCharacterModal:character-1',
    'editStatModal:character-1:count:stat-1',
    'editCharacterField:character-1:core:name|Name|short',
    'adjustStatModal:character-1:stat-1',
    'editStatTemplateModal:stat-1',
  ])('routes message-updating modal %s through component update auto-deferral', (customId) => {
    expect(getModalInteractionPolicy(modalInteraction(customId, true))).toEqual(
      componentUpdatePolicy,
    );
  });

  test.each(['addInventoryModal:character-1:0', 'editInventoryModal:character-1:item-1:0'])(
    'selects the response contract for inventory modal %s from message availability',
    (customId) => {
      expect(getModalInteractionPolicy(modalInteraction(customId, true))).toEqual(
        componentUpdatePolicy,
      );
      expect(getModalInteractionPolicy(modalInteraction(customId, false))).toEqual(
        ephemeralReplyPolicy,
      );
    },
  );

  test('routes IC edit and unknown modal submissions through ephemeral reply auto-deferral', () => {
    expect(getModalInteractionPolicy(modalInteraction('ic-edit-modal:message-1', false))).toEqual(
      ephemeralReplyPolicy,
    );
    expect(getModalInteractionPolicy(modalInteraction('unknown:modal', false))).toEqual(
      ephemeralReplyPolicy,
    );
  });
});

function modalInteraction(customId: string, messageBacked: boolean): ModalSubmitInteraction {
  return {
    customId,
    message: messageBacked ? { id: 'message-1' } : null,
  } as unknown as ModalSubmitInteraction;
}
