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
import { buildIcEditModal } from './ic-edit';

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
    const { guildId, targetMessage } = interaction;

    if (!guildId) {
      return responder.respond({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    return responder.showModal(buildIcEditModal(targetMessage.id));
  },
};

function resolveIcEditContextPolicy(
  interaction: MessageContextMenuCommandInteraction<CacheType>,
): InteractionDispatchPolicy {
  if (interaction.guildId) {
    return {
      mode: { kind: 'modal' },
      acknowledgement: 'manual',
      authorization: 'modal-submit',
    };
  }

  return {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  };
}
