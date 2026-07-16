// src/handlers/modal_handlers/index.ts

import type { ModalSubmitInteraction } from 'discord.js';
import type { InteractionDispatchPolicy } from '../../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';

import { handle as handleCreateStatModal } from '../../components/create_stat_modal';
import * as characterCreationModals from './character_creation_modals';
import * as characterEditModals from './character_edit_modals';
import * as inventoryModals from './inventory_modals';
import * as icEditModal from './ic_edit_modal';
import * as statCalculatorModal from './stat_calculator_modal';
import * as statTemplateModals from './stat_template_modals';

const componentUpdateInteractionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;
const ephemeralReplyInteractionPolicy = {
  mode: { kind: 'reply', visibility: 'ephemeral' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

export function getModalInteractionPolicy(
  interaction: ModalSubmitInteraction,
): InteractionDispatchPolicy {
  const { customId } = interaction;
  if (customId.startsWith('ic-edit-modal:')) return ephemeralReplyInteractionPolicy;
  if (
    (customId.startsWith('addInventoryModal:') || customId.startsWith('editInventoryModal:')) &&
    !interaction.message
  ) {
    return ephemeralReplyInteractionPolicy;
  }
  if (
    customId.startsWith('createStatModal:') ||
    customId.startsWith('editStatTemplateModal:') ||
    customId.startsWith('createCharacterModal:') ||
    customId.startsWith('createDraftCharacterField:') ||
    customId.startsWith('editCharacterModal:') ||
    customId.startsWith('editStatModal:') ||
    customId.startsWith('setCharacterField:') ||
    customId.startsWith('editCharacterField:') ||
    customId.startsWith('adjustStatModal:') ||
    customId.startsWith('addInventoryModal:') ||
    customId.startsWith('editInventoryModal:')
  ) {
    return componentUpdateInteractionPolicy;
  }
  return ephemeralReplyInteractionPolicy;
}

export async function handleModal(
  interaction: ModalSubmitInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const { customId } = interaction;

  // === GAME ===
  if (customId.startsWith('editStatTemplateModal:'))
    return statTemplateModals.handle(interaction, responder);
  if (customId.startsWith('createStatModal:')) return handleCreateStatModal(interaction, responder);

  // === Character Creation (Draft) ===
  if (
    customId.startsWith('createCharacterModal:') ||
    customId.startsWith('createDraftCharacterField:')
  ) {
    return characterCreationModals.handle(interaction, responder);
  }

  // === Character Editing (Persisted) ===
  if (
    customId.startsWith('editCharacterModal:') ||
    customId.startsWith('editStatModal:') ||
    customId.startsWith('setCharacterField:') ||
    customId.startsWith('editCharacterField:')
  ) {
    return characterEditModals.handle(interaction, responder);
  }

  // === Stat Calculation ===
  if (customId.startsWith('adjustStatModal:'))
    return statCalculatorModal.handle(interaction, responder);

  // === Inventory ===
  if (customId.startsWith('addInventoryModal:') || customId.startsWith('editInventoryModal:')) {
    return inventoryModals.handle(interaction, responder);
  }

  // === Roleplay Proxy ===
  if (customId.startsWith('ic-edit-modal:')) return icEditModal.handle(interaction, responder);

  await responder.respond({
    content: '❓ Unknown modal submission.',
    ephemeral: true,
  });
}
