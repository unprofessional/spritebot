import {
  ApplicationCommandType,
  CacheType,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
} from 'discord.js';

import { deleteRoleplayProxyMessage } from '../services/rp_message_proxy.service';
import { resultMessage, resultReason } from './ic-delete';

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Delete IC Message')
    .setType(ApplicationCommandType.Message),

  async execute(interaction: MessageContextMenuCommandInteraction<CacheType>) {
    const { guildId, targetMessage, user } = interaction;

    if (!guildId) {
      return interaction.reply({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    const result = await deleteRoleplayProxyMessage({
      client: interaction.client,
      guildId,
      channelId: targetMessage.channelId,
      userId: user.id,
      messageId: targetMessage.id,
    });

    return interaction.reply({
      content: resultMessage(result.status, resultReason(result)),
      ephemeral: true,
    });
  },
};
