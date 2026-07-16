// src/handlers/button_handlers/index.ts

import type { ButtonInteraction } from 'discord.js';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';
import type { InteractionDispatchPolicy } from '../../discord/interaction_dispatch';

import { handle as handleCalculateStatsButton } from '../../components/calculate_character_stats_button';
import { handle as handleCharPageButton } from '../../components/character_page_buttons';
import { handle as handleConfirmDeleteCharacterButton } from '../../components/confirm_delete_character_button';
import { handle as handleConfirmIcDeleteButton } from '../../components/confirm_ic_delete_button';
import { handle as handleConfirmDeleteStat } from '../../components/confirm_delete_stat_button';
import { handle as handleConfirmPurgeButton } from '../../components/confirm_purge_button';
import { handle as handleDefineStats } from '../../components/define_stats_button';
import { handle as handleDeleteCharacter } from '../../components/delete_character_button';
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
import { interactionPolicy as confirmDeleteCharacterPolicy } from '../../components/confirm_delete_character_button';
import { interactionPolicy as confirmIcDeletePolicy } from '../../components/confirm_ic_delete_button';
import { interactionPolicy as confirmDeleteStatPolicy } from '../../components/confirm_delete_stat_button';
import { interactionPolicy as confirmPurgePolicy } from '../../components/confirm_purge_button';
import { interactionPolicy as finishStatSetupPolicy } from '../../components/finish_stat_setup_button';
import { interactionPolicy as submitCharacterPolicy } from '../../components/submit_character_button';
import { interactionPolicy as supportVerifyPolicy } from '../../components/support_verify_button';
import { interactionPolicy as toggleCharacterVisibilityPolicy } from '../../components/toggle_character_visibility_button';
import { interactionPolicy as togglePublishPolicy } from '../../components/toggle_publish_button';
import { interactionPolicy as viewParagraphFieldsPolicy } from '../../components/view_paragraph_fields_button';

import * as characterViewButtons from './character_view_buttons';
import * as fallbackButtons from './fallback_buttons';
import * as inventoryButtons from './inventory_buttons';

type ButtonRoute = [
  RegExp,
  (i: ButtonInteraction, responder?: DiscordInteractionResponder) => Promise<void>,
  InteractionDispatchPolicy?,
];

const directRoutes: ButtonRoute[] = [
  [/^defineStats:/, handleDefineStats],
  [/^editGameStats:/, handleEditGameStats],
  [/^deleteStats:/, handleDeleteStats],
  [/^finishStatSetup:/, (i, r) => handleFinishStatSetup(i, r!), finishStatSetupPolicy],
  [/^togglePublishGame:/, (i, r) => handleTogglePublishButton(i, r!), togglePublishPolicy],
  [/^confirmDeleteStat:/, (i, r) => handleConfirmDeleteStat(i, r!), confirmDeleteStatPolicy],
  [/^confirmPurgeOrphans:/, (i, r) => handleConfirmPurgeButton(i, r!), confirmPurgePolicy],
  [/^submitNewCharacter/, (i, r) => handleSubmitCharacter(i, r!), submitCharacterPolicy],
  [/^deleteCharacter/, handleDeleteCharacter],
  [
    /^confirmDeleteCharacter/,
    (i, r) => handleConfirmDeleteCharacterButton(i, r!),
    confirmDeleteCharacterPolicy,
  ],
  [/^confirmIcDelete:/, (i, r) => handleConfirmIcDeleteButton(i, r!), confirmIcDeletePolicy],
  [/^cancelIcDelete:/, (i, r) => handleConfirmIcDeleteButton(i, r!), confirmIcDeletePolicy],
  [/^supportVerify:/, (i, r) => handleSupportVerifyButton(i, r!), supportVerifyPolicy],
  [/^charPage:/, (i, r) => handleCharPageButton(i, r!), charPagePolicy],
  [/^editCharacterStat/, handleEditCharacterStatsButton],
  [/^calculateCharacterStats:/, handleCalculateStatsButton],
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

export function getButtonInteractionPolicy(
  customId: string,
): InteractionDispatchPolicy | undefined {
  return directRoutes.find(([pattern]) => pattern.test(customId))?.[2];
}

export async function handleButton(
  interaction: ButtonInteraction,
  responder?: DiscordInteractionResponder,
): Promise<void> {
  const { customId } = interaction;

  for (const [pattern, handler] of directRoutes) {
    if (pattern.test(customId)) return handler(interaction, responder);
  }

  if (
    /^add_inventory_item:/.test(customId) ||
    /^view_inventory:/.test(customId) ||
    /^inventoryPage:/.test(customId) ||
    /^invEq:/.test(customId) ||
    /^invEdit:/.test(customId) ||
    /^invDel:/.test(customId) ||
    /^invDelOk:/.test(customId) ||
    /^toggle_inventory_item_equipped:/.test(customId) ||
    /^edit_inventory_item:/.test(customId) ||
    /^delete_inventory_item:/.test(customId) ||
    /^confirm_delete_inventory_item:/.test(customId) ||
    /^cancel_inventory_item_action:/.test(customId) ||
    /^clear_inventory:/.test(customId) ||
    /^confirm_clear_inventory:/.test(customId) ||
    /^cancel_clear_inventory:/.test(customId)
  ) {
    return inventoryButtons.handle(interaction);
  }

  if (customId.startsWith('goBackToCharacter:')) {
    return characterViewButtons.handle(interaction);
  }

  return fallbackButtons.handle(interaction);
}
