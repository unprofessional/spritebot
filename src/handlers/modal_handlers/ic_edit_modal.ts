import type { ModalSubmitInteraction } from 'discord.js';

import { resultMessage, resultReason } from '../../commands/ic-edit';
import { editRoleplayProxyMessage } from '../../services/rp_message_proxy.service';

export async function handle(interaction: ModalSubmitInteraction): Promise<void> {
  const [, messageId] = interaction.customId.split(':');
  if (!messageId || !interaction.guildId) {
    await interaction.reply({
      content: '⚠️ This edit request is invalid or is no longer available.',
      ephemeral: true,
    });
    return;
  }

  const result = await editRoleplayProxyMessage({
    client: interaction.client,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    messageId,
    content: interaction.fields.getTextInputValue('content'),
  });

  await interaction.reply({
    content: resultMessage(result.status, resultReason(result)),
    ephemeral: true,
  });
}
