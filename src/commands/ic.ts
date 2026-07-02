import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { setUserChannelInCharacterMode } from '../services/rp_channel_mode.service';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ic')
    .setDescription('Set your messages in this channel to in-character roleplay proxy mode.'),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    const { channelId, guildId, user } = interaction;

    if (!guildId) {
      return interaction.reply({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    await setUserChannelInCharacterMode({
      guildId,
      channelId,
      userId: user.id,
      isIc: true,
    });

    return interaction.reply({
      content:
        '✅ You are now in-character in this channel. Your messages here will proxy through your active character.',
      ephemeral: true,
    });
  },
};
