import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { buildPrompt as buildIcDeleteConfirmation } from '../components/confirm_ic_delete_button';
import { parseDiscordMessageReference } from '../utils/discord_message_reference';
import { resultMessage, resultReason } from '../utils/ic_delete_result';

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

    return interaction.reply(
      buildIcDeleteConfirmation(reference.channelId, reference.messageId, user.id),
    );
  },
  resultMessage,
  resultReason,
};
