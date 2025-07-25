// src/commands/switch-character.ts

import { SlashCommandBuilder, ChatInputCommandInteraction, CacheType } from 'discord.js';

import { build as buildSwitchCharacterSelector } from '../components/switch_character_selector';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('switch-character')
    .setDescription('Select one of your characters from your current game to make active.'),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    const { user, guild } = interaction;

    if (!guild) {
      return interaction.reply({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    const response = await buildSwitchCharacterSelector(user.id, guild.id);
    return interaction.reply(response);
  },
};
