// src/handlers/button_handlers/index.ts

import type { ButtonInteraction } from 'discord.js';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';
import type { InteractionDispatchPolicy } from '../../discord/interaction_dispatch';
import {
  activatePreparedModal,
  preparedModalInteractionPolicy,
} from '../../discord/prepared_modal';

import { handle as handleCalculateStatsButton } from '../../components/calculate_character_stats_button';
import { handle as handleCharPageButton } from '../../components/character_page_buttons';
import { handle as handleConfirmDeleteCharacterButton } from '../../components/confirm_delete_character_button';
import { handle as handleConfirmIcDeleteButton } from '../../components/confirm_ic_delete_button';
import { handle as handleConfirmDeleteStat } from '../../components/confirm_delete_stat_button';
import { handle as handleConfirmPurgeButton } from '../../components/confirm_purge_button';
import { handle as handleDefineStats } from '../../components/define_stats_button';
import { handle as handleDeleteCharacter } from '../../components/delete_character_button';
import { handle as handleDeleteGame } from '../../components/delete_game_button';
import { handle as handleConfirmDeleteGame } from '../../components/confirm_delete_game_button';
import { handle as handleDeleteStats } from '../../components/delete_stat_button';
import { handle as handleEditCharacterStatsButton } from '../../components/edit_character_stats_button';
import { handle as handleEditGameStats } from '../../components/edit_game_stat_button';
import { handle as handleFinishStatSetup } from '../../components/finish_stat_setup_button';
import { handle as handleSubmitCharacter } from '../../components/submit_character_button';
import { handle as handleSupportVerifyButton } from '../../components/support_verify_button';
import { handle as handleToggleCharacterVisibilityButton } from '../../components/toggle_character_visibility_button';
import { handle as handleTogglePublishButton } from '../../components/toggle_publish_button';
import { handle as handleViewParagraphFieldsButton } from '../../components/view_paragraph_fields_button';
import { interactionPolicy as charPagePolicy } from '../../components/character_page_buttons';
import { interactionPolicy as calculateStatsPolicy } from '../../components/calculate_character_stats_button';
import { interactionPolicy as confirmDeleteCharacterPolicy } from '../../components/confirm_delete_character_button';
import { interactionPolicy as confirmIcDeletePolicy } from '../../components/confirm_ic_delete_button';
import { interactionPolicy as confirmDeleteStatPolicy } from '../../components/confirm_delete_stat_button';
import { interactionPolicy as confirmPurgePolicy } from '../../components/confirm_purge_button';
import { interactionPolicy as defineStatsPolicy } from '../../components/define_stats_button';
import { interactionPolicy as deleteCharacterPolicy } from '../../components/delete_character_button';
import { interactionPolicy as deleteGamePolicy } from '../../components/delete_game_button';
import { interactionPolicy as confirmDeleteGamePolicy } from '../../components/confirm_delete_game_button';
import { interactionPolicy as deleteStatsPolicy } from '../../components/delete_stat_button';
import { interactionPolicy as editCharacterStatsPolicy } from '../../components/edit_character_stats_button';
import { interactionPolicy as editGameStatsPolicy } from '../../components/edit_game_stat_button';
import { interactionPolicy as finishStatSetupPolicy } from '../../components/finish_stat_setup_button';
import { interactionPolicy as submitCharacterPolicy } from '../../components/submit_character_button';
import { interactionPolicy as supportVerifyPolicy } from '../../components/support_verify_button';
import { interactionPolicy as toggleCharacterVisibilityPolicy } from '../../components/toggle_character_visibility_button';
import { interactionPolicy as togglePublishPolicy } from '../../components/toggle_publish_button';
import { interactionPolicy as viewParagraphFieldsPolicy } from '../../components/view_paragraph_fields_button';

import * as helpRoleButtons from '../help/help_role_button';
import * as characterViewButtons from './character_view_buttons';
import * as fallbackButtons from './fallback_buttons';
import * as gameViewButtons from './game_view_buttons';
import * as inventoryButtons from './inventory_buttons';

type ButtonRoute = [
  RegExp,
  (i: ButtonInteraction, responder: DiscordInteractionResponder) => Promise<void>,
  InteractionDispatchPolicy,
];

const directRoutes: ButtonRoute[] = [
  [/^help:(?:role:(?:player|gm)|back)$/, helpRoleButtons.handle, helpRoleButtons.interactionPolicy],
  [/^preparedModal:/, (i, r) => activatePreparedModal(i, r!), preparedModalInteractionPolicy],
  [/^defineStats:/, (i, r) => handleDefineStats(i, r!), defineStatsPolicy],
  [/^editGameStats:/, (i, r) => handleEditGameStats(i, r!), editGameStatsPolicy],
  [/^deleteStats:/, (i, r) => handleDeleteStats(i, r!), deleteStatsPolicy],
  [/^finishStatSetup:/, (i, r) => handleFinishStatSetup(i, r!), finishStatSetupPolicy],
  [/^togglePublishGame:/, (i, r) => handleTogglePublishButton(i, r!), togglePublishPolicy],
  [/^confirmDeleteStat:/, (i, r) => handleConfirmDeleteStat(i, r!), confirmDeleteStatPolicy],
  [/^confirmPurgeOrphans:/, (i, r) => handleConfirmPurgeButton(i, r!), confirmPurgePolicy],
  [/^submitNewCharacter/, (i, r) => handleSubmitCharacter(i, r!), submitCharacterPolicy],
  [/^deleteCharacter/, (i, r) => handleDeleteCharacter(i, r!), deleteCharacterPolicy],
  [/^deleteGame:/, (i, r) => handleDeleteGame(i, r!), deleteGamePolicy],
  [/^confirmDeleteGame:/, (i, r) => handleConfirmDeleteGame(i, r!), confirmDeleteGamePolicy],
  [
    /^confirmDeleteCharacter/,
    (i, r) => handleConfirmDeleteCharacterButton(i, r!),
    confirmDeleteCharacterPolicy,
  ],
  [/^confirmIcDelete:/, (i, r) => handleConfirmIcDeleteButton(i, r!), confirmIcDeletePolicy],
  [/^cancelIcDelete:/, (i, r) => handleConfirmIcDeleteButton(i, r!), confirmIcDeletePolicy],
  [/^supportVerify:/, (i, r) => handleSupportVerifyButton(i, r!), supportVerifyPolicy],
  [/^charPage:/, (i, r) => handleCharPageButton(i, r!), charPagePolicy],
  [/^editCharacterStat/, (i, r) => handleEditCharacterStatsButton(i, r!), editCharacterStatsPolicy],
  [/^calculateCharacterStats:/, (i, r) => handleCalculateStatsButton(i, r!), calculateStatsPolicy],
  [
    /^handleToggleCharacterVisibilityButton:/,
    (i, r) => handleToggleCharacterVisibilityButton(i, r!),
    toggleCharacterVisibilityPolicy,
  ],
  [
    /^viewParagraphFields/,
    (i, r) => handleViewParagraphFieldsButton(i, r!),
    viewParagraphFieldsPolicy,
  ],
];

export function getButtonInteractionPolicy(customId: string): InteractionDispatchPolicy {
  const directRoute = directRoutes.find(([pattern]) => pattern.test(customId));
  if (directRoute) return directRoute[2];
  if (isInventoryButton(customId)) return inventoryButtons.getInteractionPolicy(customId);
  if (customId.startsWith('goBackToCharacter:')) return characterViewButtons.interactionPolicy;
  if (customId.startsWith('goBackToGame:')) return gameViewButtons.interactionPolicy;
  return fallbackButtons.interactionPolicy;
}

function isInventoryButton(customId: string): boolean {
  return /^(?:add_inventory_item|view_inventory|inventoryPage|invEq|invEdit|invDel|invDelOk|toggle_inventory_item_equipped|edit_inventory_item|delete_inventory_item|confirm_delete_inventory_item|cancel_inventory_item_action|clear_inventory|confirm_clear_inventory|cancel_clear_inventory):/.test(
    customId,
  );
}

export async function handleButton(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const { customId } = interaction;

  for (const [pattern, handler] of directRoutes) {
    if (pattern.test(customId)) return handler(interaction, responder);
  }

  if (isInventoryButton(customId)) {
    return inventoryButtons.handle(interaction, responder);
  }

  if (customId.startsWith('goBackToCharacter:')) {
    return characterViewButtons.handle(interaction, responder);
  }

  if (customId.startsWith('goBackToGame:')) {
    return gameViewButtons.handle(interaction, responder);
  }

  return fallbackButtons.handle(interaction, responder);
}
