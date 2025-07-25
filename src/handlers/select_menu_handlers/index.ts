// src/handlers/select_menu_handlers/index.ts

import type { StringSelectMenuInteraction } from 'discord.js';

import { handle as characterFieldSelectorHandler } from '../../components/character_field_selector';
import { handle as deleteStatSelectorHandler } from '../../components/delete_stat_selector';
import { handle as characterEditFieldSelectorHandler } from '../../components/edit_character_field_selector';
import { handle as editStatSelectorHandler } from '../../components/edit_stat_selector';
import { handle as handleJoinGameSelector } from '../../components/join_game_selector';
import { handle as handleParagraphFieldSelector } from '../../components/paragraph_field_selector';
import { handle as handlePublicCharacterSelector } from '../../components/public_character_selector';
import { handle as statTypeSelectorHandler } from '../../components/stat_type_selector';
import { handle as handleSwitchCharacterSelector } from '../../components/switch_character_selector';
import { handle as handleSwitchGameSelector } from '../../components/switch_game_selector';
import * as adjustNumericStatSelectHandler from './adjust_numeric_stat_select';
import * as characterStatSelect from './character_stat_select_menu';

export async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const { customId } = interaction;

  if (customId === 'switchCharacterDropdown') return handleSwitchCharacterSelector(interaction);
  if (customId === 'switchGameDropdown') return handleSwitchGameSelector(interaction);
  if (customId === 'joinGameDropdown') return handleJoinGameSelector(interaction);
  if (customId.startsWith('editStatSelect:')) return editStatSelectorHandler(interaction);
  if (customId.startsWith('deleteStatSelect:')) return deleteStatSelectorHandler(interaction);
  if (customId.startsWith('selectStatType:')) return statTypeSelectorHandler(interaction);
  if (customId.startsWith('createCharacterDropdown'))
    return characterFieldSelectorHandler(interaction);
  if (customId.startsWith('editCharacterFieldDropdown'))
    return characterEditFieldSelectorHandler(interaction);
  if (customId.startsWith('selectPublicCharacter'))
    return handlePublicCharacterSelector(interaction);
  if (customId.startsWith('paragraphFieldSelect')) return handleParagraphFieldSelector(interaction);
  if (customId.startsWith('editCharacterStatDropdown:'))
    return characterStatSelect.handle(interaction);
  if (customId.startsWith('adjustStatSelect:'))
    return adjustNumericStatSelectHandler.handle(interaction);

  await interaction.reply({
    content: '❌ Unknown menu selection.',
    ephemeral: true,
  });
}
