// src/commands/join-game.ts

import { SlashCommandBuilder, ChatInputCommandInteraction, CacheType } from 'discord.js';

import { build as buildJoinGameSelector } from '../components/join_game_selector';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('join-game')
    .setDescription('Select a public game in this server to join.'),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    const { user, guild } = interaction;

    if (!guild) {
      return interaction.reply({
        content: '⚠️ You must use this command in a server (not DMs).',
        ephemeral: true,
      });
    }

    const response = await buildJoinGameSelector(user.id, guild.id);
    return interaction.reply(response);
  },
};
