// src/handlers/modal_handlers/index.ts

import type { ModalSubmitInteraction } from 'discord.js';

import { handle as handleCreateStatModal } from '../../components/create_stat_modal';
import * as characterCreationModals from './character_creation_modals';
import * as characterEditModals from './character_edit_modals';
import * as inventoryModals from './inventory_modals';
import * as statCalculatorModal from './stat_calculator_modal';
import * as statTemplateModals from './stat_template_modals';

export async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  const { customId } = interaction;

  // === GAME ===
  if (customId.startsWith('editStatTemplateModal:')) return statTemplateModals.handle(interaction);
  if (customId.startsWith('createStatModal:')) return handleCreateStatModal(interaction);

  // === Character Creation (Draft) ===
  if (
    customId.startsWith('createCharacterModal:') ||
    customId.startsWith('createDraftCharacterField:')
  ) {
    return characterCreationModals.handle(interaction);
  }

  // === Character Editing (Persisted) ===
  if (
    customId.startsWith('editCharacterModal:') ||
    customId.startsWith('editStatModal:') ||
    customId.startsWith('setCharacterField:') ||
    customId.startsWith('editCharacterField:')
  ) {
    return characterEditModals.handle(interaction);
  }

  // === Stat Calculation ===
  if (customId.startsWith('adjustStatModal:')) return statCalculatorModal.handle(interaction);

  // === Inventory ===
  if (customId.startsWith('addInventoryModal:')) return inventoryModals.handle(interaction);

  await interaction.reply({
    content: '❓ Unknown modal submission.',
    ephemeral: true,
  });
}
