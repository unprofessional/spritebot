import {
  ApplicationCommandType,
  CacheType,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
} from 'discord.js';

import { buildPrompt as buildIcDeleteConfirmation } from '../components/confirm_ic_delete_button';

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

    return interaction.reply(
      buildIcDeleteConfirmation(targetMessage.channelId, targetMessage.id, user.id),
    );
  },
};
