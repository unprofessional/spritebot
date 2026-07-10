import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { setUserChannelInCharacterMode } from '../services/rp_channel_mode.service';
import { appendNudge, buildNudge } from '../utils/onboarding_nudge';

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
      content: appendNudge(
        '✅ You are now in-character in this channel.',
        buildNudge({ userId: user.id, guildId, isInIC: true }, 'ic'),
      ),
      ephemeral: true,
    });
  },
};
