import {
  ApplicationCommandType,
  CacheType,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
} from 'discord.js';

import { fetchProxyMessageContent } from '../services/rp_message_proxy.service';
import { buildIcEditModal, resultMessage, resultReason } from './ic-edit';

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Edit IC Message')
    .setType(ApplicationCommandType.Message),

  async execute(interaction: MessageContextMenuCommandInteraction<CacheType>) {
    const { guildId, targetMessage, user } = interaction;

    if (!guildId) {
      return interaction.reply({
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
      return interaction.reply({
        content: resultMessage(result.status, resultReason(result)),
        ephemeral: true,
      });
    }

    return interaction.showModal(buildIcEditModal(targetMessage.id, result.content));
  },
};
