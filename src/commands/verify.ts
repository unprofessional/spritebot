import {
  CacheType,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  type GuildMember,
} from 'discord.js';

import { supportGuildId } from '../config/env_config';
import {
  verifySupportMember,
  type SupportVerificationResult,
} from '../services/support_verification.service';
import { buildSupportVerificationMessage } from '../utils/support_verification_messages';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';
import { defineDiscordOperationPolicy } from '../discord/operation_policy';
import { executeDiscordSdkMethodAs } from '../discord/sdk_operations';

const supportMemberReadPolicy = defineDiscordOperationPolicy({
  operation: 'support.verify.fetch-member',
  timeoutMs: 1_500,
  totalBudgetMs: 4_000,
  retry: 'safe-read',
  maxAttempts: 2,
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verify your SPRITEbot subscription or player status in the support server.'),

  interactionPolicy: {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  } satisfies InteractionDispatchPolicy,

  async execute(
    interaction: ChatInputCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    if (!interaction.guild || interaction.guildId !== supportGuildId) {
      return responder.respond({
        content: 'Use `/verify` in the SPRITEbot support server.',
        ephemeral: true,
      });
    }

    let result: SupportVerificationResult;
    try {
      const member = await executeDiscordSdkMethodAs<GuildMember>(
        supportMemberReadPolicy,
        interaction.guild.members,
        'fetch',
        interaction.user.id,
      );
      result = await verifySupportMember(member);
    } catch (err) {
      console.error('[verify] Support verification failed:', err);
      return responder.respond({
        content:
          '⚠️ I found the support server, but could not finish assigning verification roles. Please ask a server admin to check my role permissions and configured role IDs.',
        ephemeral: true,
      });
    }

    return responder.respond({
      content: await buildSupportVerificationMessage(interaction, result),
      ephemeral: true,
    });
  },
};
