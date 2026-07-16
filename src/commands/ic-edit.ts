import {
  ActionRowBuilder,
  CacheType,
  ChatInputCommandInteraction,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import type {
  RpProxyContentResult,
  RpProxyMutationResult,
} from '../services/rp_message_proxy.service';
import { fetchProxyMessageContent } from '../services/rp_message_proxy.service';
import { parseDiscordMessageReference } from '../utils/discord_message_reference';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
  InteractionDispatchPolicySource,
} from '../discord/interaction_dispatch';
import { presentPreparedModal } from '../discord/prepared_modal';

export function resultMessage(status: string, reason?: string): string {
  if (status === 'updated') return '✅ Updated your proxied RP message.';
  if (status === 'forbidden') return '⛔ You can only edit your own proxied RP messages.';
  if (status === 'not_found') {
    return '⚠️ I could not find a tracked proxied RP message for that ID or link.';
  }
  if (status === 'invalid_content' && reason === 'empty') {
    return '⚠️ Replacement content cannot be empty.';
  }
  if (status === 'invalid_content' && reason === 'too_long') {
    return '⚠️ Replacement content must be 2000 characters or fewer.';
  }
  if (status === 'failed' && reason === 'webhook_not_found') {
    return '⚠️ I could not find the webhook that created that proxied message.';
  }
  if (status === 'failed' && reason === 'channel_cannot_webhook') {
    return '⚠️ That channel cannot be managed through RP webhooks.';
  }
  if (status === 'failed' && reason === 'message_not_found') {
    return '⚠️ That proxied RP message no longer exists in Discord.';
  }

  return '❌ Failed to update that proxied RP message.';
}

export function buildIcEditModal(messageId: string, content?: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId('content')
    .setLabel('Message Content')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000);
  if (content) input.setValue(content);

  return new ModalBuilder()
    .setCustomId(`ic-edit-modal:${messageId}`)
    .setTitle('Edit IC Message')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export function resultReason(
  result: RpProxyContentResult | RpProxyMutationResult,
): string | undefined {
  return 'reason' in result ? result.reason : undefined;
}

module.exports = {
  buildIcEditModal,
  data: new SlashCommandBuilder()
    .setName('ic-edit')
    .setDescription('Edit one of your proxied in-character messages.')
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('The proxied message ID or message link')
        .setRequired(true),
    ),

  interactionPolicy: ((interaction: ChatInputCommandInteraction<CacheType>) =>
    resolveIcEditPolicy(interaction)) satisfies InteractionDispatchPolicySource<
    ChatInputCommandInteraction<CacheType>
  >,

  async execute(
    interaction: ChatInputCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    if (responder.state === 'expired') return;

    const { channelId, guildId } = interaction;

    if (!guildId) {
      return responder.respond({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    const reference = parseDiscordMessageReference(
      interaction.options.getString('message', true),
      channelId,
    );
    if (!reference || (reference.guildId && reference.guildId !== guildId)) {
      return responder.respond({
        content: '⚠️ Provide a valid message ID or a message link from this server.',
        ephemeral: true,
      });
    }

    const result = await fetchProxyMessageContent({
      client: interaction.client,
      guildId,
      channelId: reference.channelId,
      userId: interaction.user.id,
      messageId: reference.messageId,
    });

    if (result.status !== 'found') {
      return responder.respond({
        content: resultMessage(result.status, resultReason(result)),
        ephemeral: true,
      });
    }

    return presentPreparedModal({
      modal: buildIcEditModal(reference.messageId, result.content),
      responder,
      userId: interaction.user.id,
    });
  },
  resultMessage,
  resultReason,
};

function resolveIcEditPolicy(
  interaction: ChatInputCommandInteraction<CacheType>,
): InteractionDispatchPolicy {
  const reference = parseDiscordMessageReference(
    interaction.options.getString('message', true),
    interaction.channelId,
  );
  if (
    interaction.guildId &&
    reference &&
    (!reference.guildId || reference.guildId === interaction.guildId)
  ) {
    return {
      mode: { kind: 'modal-or-reply', visibility: 'ephemeral' },
      acknowledgement: 'auto-defer',
      authorization: 'modal-submit',
    };
  }

  return {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  };
}
