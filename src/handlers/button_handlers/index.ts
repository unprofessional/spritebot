// src/handlers/button_handlers/index.ts

import type { ButtonInteraction } from 'discord.js';

import { handle as handleCalculateStatsButton } from '../../components/calculate_character_stats_button';
import { handle as handleCharPageButton } from '../../components/character_page_buttons';
import { handle as handleConfirmDeleteCharacterButton } from '../../components/confirm_delete_character_button';
import { handle as handleConfirmDeleteStat } from '../../components/confirm_delete_stat_button';
import { handle as handleDefineStats } from '../../components/define_stats_button';
import { handle as handleDeleteCharacter } from '../../components/delete_character_button';
import { handle as handleDeleteStats } from '../../components/delete_stat_button';
import { handle as handleEditCharacterStatsButton } from '../../components/edit_character_stats_button';
import { handle as handleEditGameStats } from '../../components/edit_game_stat_button';
import { handle as handleFinishStatSetup } from '../../components/finish_stat_setup_button';
import { handle as handleSubmitCharacter } from '../../components/submit_character_button';
import { handle as handleToggleCharacterVisibilityButton } from '../../components/toggle_character_visibility_button';
import { handle as handleTogglePublishButton } from '../../components/toggle_publish_button';
import { handle as handleViewParagraphFieldsButton } from '../../components/view_paragraph_fields_button';

import * as characterViewButtons from './character_view_buttons';
import * as fallbackButtons from './fallback_buttons';
import * as inventoryButtons from './inventory_buttons';

const directRoutes: [RegExp, (i: ButtonInteraction) => Promise<void>][] = [
  [/^defineStats:/, handleDefineStats],
  [/^editGameStats:/, handleEditGameStats],
  [/^deleteStats:/, handleDeleteStats],
  [/^finishStatSetup:/, handleFinishStatSetup],
  [/^togglePublishGame:/, handleTogglePublishButton],
  [/^confirmDeleteStat:/, handleConfirmDeleteStat],
  [/^submitNewCharacter/, handleSubmitCharacter],
  [/^deleteCharacter/, handleDeleteCharacter],
  [/^confirmDeleteCharacter/, handleConfirmDeleteCharacterButton],
  [/^charPage:/, handleCharPageButton],
  [/^editCharacterStat/, handleEditCharacterStatsButton],
  [/^calculateCharacterStats:/, handleCalculateStatsButton],
  [/^handleToggleCharacterVisibilityButton:/, handleToggleCharacterVisibilityButton],
  [/^viewParagraphFields/, handleViewParagraphFieldsButton],
];

export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const { customId } = interaction;

  for (const [pattern, handler] of directRoutes) {
    if (pattern.test(customId)) return handler(interaction);
  }

  if (
    /^add_inventory_item:/.test(customId) ||
    /^view_inventory:/.test(customId) ||
    /^clear_inventory:/.test(customId) ||
    /^confirm_clear_inventory:/.test(customId) ||
    customId === 'cancel_clear_inventory'
  ) {
    return inventoryButtons.handle(interaction);
  }

  if (customId.startsWith('goBackToCharacter:')) {
    return characterViewButtons.handle(interaction);
  }

  return fallbackButtons.handle(interaction);
}
