import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { setUserChannelInCharacterMode } from '../services/rp_channel_mode.service';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ooc')
    .setDescription('Set your messages in this channel to out-of-character mode.'),

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
      isIc: false,
    });

    return interaction.reply({
      content:
        '✅ You are now out-of-character in this channel. Your messages here will no longer be proxied.',
      ephemeral: true,
    });
  },
};
