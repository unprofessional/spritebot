import type { ModalSubmitInteraction } from 'discord.js';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';

import { resultMessage, resultReason } from '../../commands/ic-edit';
import { editRoleplayProxyMessage } from '../../services/rp_message_proxy.service';

export async function handle(
  interaction: ModalSubmitInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [, messageId] = interaction.customId.split(':');
  if (!messageId || !interaction.guildId) {
    await responder.respond({
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

  await responder.respond({
    content: resultMessage(result.status, resultReason(result)),
    ephemeral: true,
  });
}
