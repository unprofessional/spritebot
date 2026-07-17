// src/handlers/select_menu_handlers/index.ts

import type { StringSelectMenuInteraction } from 'discord.js';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';
import type { InteractionDispatchPolicy } from '../../discord/interaction_dispatch';

import { handle as characterFieldSelectorHandler } from '../../components/character_field_selector';
import { handle as deleteStatSelectorHandler } from '../../components/delete_stat_selector';
import { handle as characterEditFieldSelectorHandler } from '../../components/edit_character_field_selector';
import { handle as editStatSelectorHandler } from '../../components/edit_stat_selector';
import { handle as handleJoinGameSelector } from '../../components/join_game_selector';
import { handle as handleParagraphFieldSelector } from '../../components/paragraph_field_selector';
import { handle as handlePublicCharacterSelector } from '../../components/public_character_selector';
import { handle as handleRestoreCharacterSelector } from '../../components/restore_character_selector';
import { handle as handleRestoreGameSelector } from '../../components/restore_game_selector';
import { handle as statTypeSelectorHandler } from '../../components/stat_type_selector';
import { handle as handleSwitchCharacterSelector } from '../../components/switch_character_selector';
import { handle as handleSwitchGameSelector } from '../../components/switch_game_selector';
import { interactionPolicy as joinGamePolicy } from '../../components/join_game_selector';
import { interactionPolicy as characterFieldPolicy } from '../../components/character_field_selector';
import { interactionPolicy as editCharacterFieldPolicy } from '../../components/edit_character_field_selector';
import { interactionPolicy as editStatPolicy } from '../../components/edit_stat_selector';
import { interactionPolicy as deleteStatPolicy } from '../../components/delete_stat_selector';
import { interactionPolicy as paragraphFieldPolicy } from '../../components/paragraph_field_selector';
import { interactionPolicy as publicCharacterPolicy } from '../../components/public_character_selector';
import { interactionPolicy as restoreCharacterPolicy } from '../../components/restore_character_selector';
import { interactionPolicy as restoreGamePolicy } from '../../components/restore_game_selector';
import { interactionPolicy as switchCharacterPolicy } from '../../components/switch_character_selector';
import { interactionPolicy as switchGamePolicy } from '../../components/switch_game_selector';
import { interactionPolicy as statTypePolicy } from '../../components/stat_type_selector';
import * as helpCategorySelect from '../help/help_category_select';
import * as adjustNumericStatSelectHandler from './adjust_numeric_stat_select';
import * as characterStatSelect from './character_stat_select_menu';
import * as inventoryItemSelect from './inventory_item_select';

const fallbackInteractionPolicy = {
  mode: { kind: 'reply', visibility: 'ephemeral' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

export function getSelectMenuInteractionPolicy(customId: string): InteractionDispatchPolicy {
  if (customId.startsWith('help:category:')) return helpCategorySelect.interactionPolicy;
  if (customId === 'switchCharacterDropdown') return switchCharacterPolicy;
  if (customId === 'switchGameDropdown') return switchGamePolicy;
  if (customId === 'joinGameDropdown') return joinGamePolicy;
  if (customId === 'restoreCharacterDropdown') return restoreCharacterPolicy;
  if (customId === 'restoreGameDropdown') return restoreGamePolicy;
  if (customId.startsWith('selectPublicCharacter')) return publicCharacterPolicy;
  if (customId.startsWith('paragraphFieldSelect')) return paragraphFieldPolicy;
  if (customId.startsWith('editInventoryItemSelect:')) return inventoryItemSelect.interactionPolicy;
  if (customId.startsWith('selectStatType:')) return statTypePolicy;
  if (customId.startsWith('createCharacterDropdown')) return characterFieldPolicy;
  if (customId.startsWith('editCharacterFieldDropdown')) return editCharacterFieldPolicy;
  if (customId.startsWith('editStatSelect:')) return editStatPolicy;
  if (customId.startsWith('editCharacterStatDropdown:')) {
    return characterStatSelect.interactionPolicy;
  }
  if (customId.startsWith('adjustStatSelect:'))
    return adjustNumericStatSelectHandler.interactionPolicy;
  if (customId.startsWith('deleteStatSelect:')) return deleteStatPolicy;
  return fallbackInteractionPolicy;
}

export async function handleSelectMenu(
  interaction: StringSelectMenuInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const { customId } = interaction;

  if (customId.startsWith('help:category:'))
    return helpCategorySelect.handle(interaction, responder);
  if (customId === 'switchCharacterDropdown')
    return handleSwitchCharacterSelector(interaction, responder);
  if (customId === 'switchGameDropdown') return handleSwitchGameSelector(interaction, responder);
  if (customId === 'joinGameDropdown') return handleJoinGameSelector(interaction, responder);
  if (customId === 'restoreCharacterDropdown')
    return handleRestoreCharacterSelector(interaction, responder);
  if (customId === 'restoreGameDropdown') return handleRestoreGameSelector(interaction, responder);
  if (customId.startsWith('editStatSelect:'))
    return editStatSelectorHandler(interaction, responder);
  if (customId.startsWith('deleteStatSelect:'))
    return deleteStatSelectorHandler(interaction, responder);
  if (customId.startsWith('selectStatType:'))
    return statTypeSelectorHandler(interaction, responder);
  if (customId.startsWith('createCharacterDropdown'))
    return characterFieldSelectorHandler(interaction, responder);
  if (customId.startsWith('editCharacterFieldDropdown'))
    return characterEditFieldSelectorHandler(interaction, responder);
  if (customId.startsWith('selectPublicCharacter'))
    return handlePublicCharacterSelector(interaction, responder);
  if (customId.startsWith('paragraphFieldSelect'))
    return handleParagraphFieldSelector(interaction, responder);
  if (customId.startsWith('editCharacterStatDropdown:'))
    return characterStatSelect.handle(interaction, responder);
  if (customId.startsWith('adjustStatSelect:'))
    return adjustNumericStatSelectHandler.handle(interaction, responder);
  if (customId.startsWith('editInventoryItemSelect:'))
    return inventoryItemSelect.handle(interaction, responder);

  await responder.respond({ content: '❌ Unknown menu selection.', ephemeral: true });
}
