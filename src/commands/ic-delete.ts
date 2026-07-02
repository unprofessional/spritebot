import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { deleteRoleplayProxyMessage } from '../services/rp_message_proxy.service';
import { parseDiscordMessageReference } from '../utils/discord_message_reference';

function resultMessage(status: string, reason?: string): string {
  if (status === 'deleted') return '🗑️ Deleted your proxied RP message.';
  if (status === 'forbidden') return '⛔ You can only delete your own proxied RP messages.';
  if (status === 'not_found') {
    return '⚠️ I could not find a tracked proxied RP message for that ID or link.';
  }
  if (status === 'failed' && reason === 'webhook_not_found') {
    return '⚠️ I could not find the webhook that created that proxied message.';
  }
  if (status === 'failed' && reason === 'channel_cannot_webhook') {
    return '⚠️ That channel cannot be managed through RP webhooks.';
  }

  return '❌ Failed to delete that proxied RP message.';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ic-delete')
    .setDescription('Delete one of your proxied in-character messages.')
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('The proxied message ID or message link')
        .setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    const { channelId, guildId, user } = interaction;

    if (!guildId) {
      return interaction.reply({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    const reference = parseDiscordMessageReference(
      interaction.options.getString('message', true),
      channelId,
    );
    if (!reference || (reference.guildId && reference.guildId !== guildId)) {
      return interaction.reply({
        content: '⚠️ Provide a valid message ID or a message link from this server.',
        ephemeral: true,
      });
    }

    const result = await deleteRoleplayProxyMessage({
      client: interaction.client,
      guildId,
      channelId: reference.channelId,
      userId: user.id,
      messageId: reference.messageId,
    });

    return interaction.reply({
      content: resultMessage(result.status, 'reason' in result ? result.reason : undefined),
      ephemeral: true,
    });
  },
};
