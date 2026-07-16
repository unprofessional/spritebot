import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CacheType,
  type GuildMember,
} from 'discord.js';

import { supportGuildId } from '../config/env_config';
import { verifySupportMember } from '../services/support_verification.service';
import { buildSupportVerificationMessage } from '../utils/support_verification_messages';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import { defineDiscordOperationPolicy } from '../discord/operation_policy';
import { executeDiscordSdkMethodAs } from '../discord/sdk_operations';

const id = 'supportVerify';
const interactionPolicy = {
  mode: { kind: 'reply', visibility: 'ephemeral' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;
const supportMemberReadPolicy = defineDiscordOperationPolicy({
  operation: 'support.verify-button.fetch-member',
  timeoutMs: 1_500,
  totalBudgetMs: 4_000,
  retry: 'safe-read',
  maxAttempts: 2,
});

function build(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${id}:verify`)
      .setLabel('Verify')
      .setStyle(ButtonStyle.Primary),
  );
}

function buildGreeting() {
  return {
    content: [
      '**Welcome to the SPRITEbot Support Server! 👋**',
      '',
      "This is the vestibule — you'll start here until you've been verified.",
      '',
      '**How to get in:**',
      'Click **Verify** below.',
      "SPRITEbot will check whether you're a **subscriber** (you own an active Premium subscription on a server) or a **player** (you're in a game on a subscribing server) and assign your role automatically.",
      '',
      'Once verified, the rest of the server opens up — general chat, bug reports, feature requests, and more.',
    ].join('\n'),
    components: [build()],
  };
}

async function handle(
  interaction: ButtonInteraction<CacheType>,
  responder: DiscordInteractionResponder,
): Promise<void> {
  if (!interaction.guild || interaction.guildId !== supportGuildId) {
    await responder.respond({
      content: 'Use this verification button in the SPRITEbot support server.',
      ephemeral: true,
    });
    return;
  }

  let content: string;
  try {
    const member = await executeDiscordSdkMethodAs<GuildMember>(
      supportMemberReadPolicy,
      interaction.guild.members,
      'fetch',
      interaction.user.id,
    );
    const result = await verifySupportMember(member);
    content = await buildSupportVerificationMessage(interaction, result);
  } catch (err) {
    console.error('[support_verify_button] Support verification failed:', err);
    content =
      '⚠️ I found the support server, but could not finish assigning verification roles. Please ask a server admin to check my role permissions and configured role IDs.';
  }

  await responder.respond({ content, ephemeral: true });
}

export { id, build, buildGreeting, handle, interactionPolicy };
