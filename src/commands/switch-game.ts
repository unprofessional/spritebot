// src/commands/switch-game.ts

import { SlashCommandBuilder, ChatInputCommandInteraction, CacheType } from 'discord.js';

import { build as buildSwitchGameSelector } from '../components/switch_game_selector';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('switch-game')
    .setDescription('Select one of your games to make active.'),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    const { user, guild } = interaction;

    if (!guild) {
      return interaction.reply({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    const response = await buildSwitchGameSelector(user.id, guild.id);
    return interaction.reply(response);
  },
};
