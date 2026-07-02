import {
  CacheType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { setChannelInCharacterMode } from '../services/rp_channel_mode.service';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ic')
    .setDescription('Set this channel to in-character roleplay proxy mode.')
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
      isIc: true,
      updatedBy: user.id,
    });

    return interaction.reply({
      content:
        '✅ This channel is now in-character. Player messages will proxy through their active character.',
      ephemeral: true,
    });
  },
};
