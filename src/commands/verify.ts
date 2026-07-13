import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { supportGuildId } from '../config/env_config';
import {
  verifySupportMember,
  type SupportVerificationResult,
} from '../services/support_verification.service';
import { buildSupportVerificationMessage } from '../utils/support_verification_messages';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verify your SPRITEbot subscription or player status in the support server.'),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    if (!interaction.guild || interaction.guildId !== supportGuildId) {
      return interaction.reply({
        content: 'Use `/verify` in the SPRITEbot support server.',
        ephemeral: true,
      });
    }

    let result: SupportVerificationResult;
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      result = await verifySupportMember(member);
    } catch (err) {
      console.error('[verify] Support verification failed:', err);
      return interaction.reply({
        content:
          '⚠️ I found the support server, but could not finish assigning verification roles. Please ask a server admin to check my role permissions and configured role IDs.',
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: await buildSupportVerificationMessage(interaction, result),
      ephemeral: true,
    });
  },
};
