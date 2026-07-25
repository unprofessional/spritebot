import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { discordCustomId } from '../utils/discord_custom_id';
// src/components/stat_type_select.ts

const id = 'selectStatType';

function buildStatTypeDropdown(gameId: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(discordCustomId(`${id}:${gameId}`))
    .setPlaceholder('➕ Add a new stat field...')
    .addOptions([
      new StringSelectMenuOptionBuilder()
        .setLabel('Number (ex. Level, EXP, Gold, Agility, etc)')
        .setValue('number')
        .setEmoji('🔢'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Count (ex. HP, MP — current/max)')
        .setValue('count')
        .setEmoji('🔁'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Short Text (one-line)')
        .setValue('short')
        .setEmoji('💬'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Paragraph Text (multi-line)')
        .setValue('paragraph')
        .setEmoji('📝'),
    ]);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
}

export { buildStatTypeDropdown, id };
