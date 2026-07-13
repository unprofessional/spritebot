import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { supportInviteUrl } from '../config/env_config';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('support')
    .setDescription('Get an invite to the SPRITEbot support server.'),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    return interaction.reply({
      content: `Need help or want to report a bug? Join the SPRITEbot support server: ${supportInviteUrl}`,
      ephemeral: true,
    });
  },
};
