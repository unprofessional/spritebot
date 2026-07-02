import {
  CacheType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { setChannelInCharacterMode } from '../services/rp_channel_mode.service';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ooc')
    .setDescription('Set this channel to out-of-character mode.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    const { channelId, guildId, user } = interaction;

    if (!guildId) {
      return interaction.reply({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    await setChannelInCharacterMode({
      guildId,
      channelId,
      isIc: false,
      updatedBy: user.id,
    });

    return interaction.reply({
      content: '✅ This channel is now out-of-character. Messages will no longer be proxied.',
      ephemeral: true,
    });
  },
};
