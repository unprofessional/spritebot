// src/commands/restore-character.ts

import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { build as buildRestoreCharacterSelector } from '../components/restore_character_selector';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restore-character')
    .setDescription('Restore one of your recently deleted characters in your current game.'),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    const { guildId, user } = interaction;

    if (!guildId) {
      return interaction.reply({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    const response = await buildRestoreCharacterSelector(user.id, guildId);
    return interaction.reply(response);
  },
};
