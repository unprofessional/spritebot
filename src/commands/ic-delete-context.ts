import {
  ApplicationCommandType,
  CacheType,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
} from 'discord.js';

import { buildPrompt as buildIcDeleteConfirmation } from '../components/confirm_ic_delete_button';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Delete IC Message')
    .setType(ApplicationCommandType.Message),

  interactionPolicy: {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  } satisfies InteractionDispatchPolicy,

  async execute(
    interaction: MessageContextMenuCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    const { guildId, targetMessage, user } = interaction;

    if (!guildId) {
      return responder.respond({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    return responder.respond(
      buildIcDeleteConfirmation(targetMessage.channelId, targetMessage.id, user.id),
    );
  },
};
