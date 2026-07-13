import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CacheType,
} from 'discord.js';

import { supportGuildId } from '../config/env_config';
import { verifySupportMember } from '../services/support_verification.service';
import { buildSupportVerificationMessage } from '../utils/support_verification_messages';

const id = 'supportVerify';

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

async function handle(interaction: ButtonInteraction<CacheType>): Promise<void> {
  if (!interaction.guild || interaction.guildId !== supportGuildId) {
    await interaction.reply({
      content: 'Use this verification button in the SPRITEbot support server.',
      ephemeral: true,
    });
    return;
  }

  try {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const result = await verifySupportMember(member);

    await interaction.reply({
      content: await buildSupportVerificationMessage(interaction, result),
      ephemeral: true,
    });
  } catch (err) {
    console.error('[support_verify_button] Support verification failed:', err);
    await interaction.reply({
      content:
        '⚠️ I found the support server, but could not finish assigning verification roles. Please ask a server admin to check my role permissions and configured role IDs.',
      ephemeral: true,
    });
  }
}

export { id, build, buildGreeting, handle };
