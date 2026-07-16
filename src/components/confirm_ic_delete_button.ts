import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CacheType,
} from 'discord.js';

import { deleteRoleplayProxyMessage } from '../services/rp_message_proxy.service';
import { resultMessage, resultReason } from '../utils/ic_delete_result';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';

const confirmId = 'confirmIcDelete';
const cancelId = 'cancelIcDelete';
const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

function build(channelId: string, messageId: string, userId: string) {
  const payload = `${channelId}:${messageId}:${userId}`;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${confirmId}:${payload}`)
      .setLabel('Confirm Delete')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${cancelId}:${payload}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildPrompt(channelId: string, messageId: string, userId: string) {
  return {
    content: 'Delete this proxied RP message?',
    components: [build(channelId, messageId, userId)],
    ephemeral: true,
  };
}

async function handle(
  interaction: ButtonInteraction<CacheType>,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const { client, customId, guildId, user } = interaction;
  const [action, channelId, messageId, ownerUserId] = customId.split(':');

  if (!guildId || !channelId || !messageId || !ownerUserId) {
    await responder.respond({
      content: '⚠️ This delete confirmation is no longer valid.',
      ephemeral: true,
    });
    return;
  }

  if (user.id !== ownerUserId) {
    await responder.respond({
      content: '⛔ Only the person who requested this delete can confirm it.',
      ephemeral: true,
    });
    return;
  }

  if (action === cancelId) {
    await responder.respond({
      content: 'Deletion canceled.',
      components: [],
    });
    return;
  }

  const result = await deleteRoleplayProxyMessage({
    client,
    guildId,
    channelId,
    userId: user.id,
    messageId,
  });

  await responder.respond({
    content: resultMessage(result.status, resultReason(result)),
    components: [],
  });
}

export { cancelId, confirmId, buildPrompt, handle, interactionPolicy };
