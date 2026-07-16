import {
  ApplicationCommandType,
  CacheType,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
} from 'discord.js';

import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
  InteractionDispatchPolicySource,
} from '../discord/interaction_dispatch';
import { presentPreparedModal } from '../discord/prepared_modal';
import { fetchProxyMessageContent } from '../services/rp_message_proxy.service';
import { buildIcEditModal, resultMessage, resultReason } from './ic-edit';

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Edit IC Message')
    .setType(ApplicationCommandType.Message),

  interactionPolicy: ((interaction: MessageContextMenuCommandInteraction<CacheType>) =>
    resolveIcEditContextPolicy(interaction)) satisfies InteractionDispatchPolicySource<
    MessageContextMenuCommandInteraction<CacheType>
  >,

  async execute(
    interaction: MessageContextMenuCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    if (responder.state === 'expired') return;

    const { guildId, targetMessage, user } = interaction;

    if (!guildId) {
      return responder.respond({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    const result = await fetchProxyMessageContent({
      client: interaction.client,
      guildId,
      channelId: targetMessage.channelId,
      userId: user.id,
      messageId: targetMessage.id,
    });

    if (result.status !== 'found') {
      return responder.respond({
        content: resultMessage(result.status, resultReason(result)),
        ephemeral: true,
      });
    }

    return presentPreparedModal({
      modal: buildIcEditModal(targetMessage.id, result.content),
      responder,
      userId: user.id,
    });
  },
};

function resolveIcEditContextPolicy(
  interaction: MessageContextMenuCommandInteraction<CacheType>,
): InteractionDispatchPolicy {
  if (interaction.guildId) {
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
