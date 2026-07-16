import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { setUserChannelInCharacterMode } from '../services/rp_channel_mode.service';
import { appendNudge, buildNudge } from '../utils/onboarding_nudge';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ooc')
    .setDescription('Set your messages in this channel to out-of-character mode.'),

  interactionPolicy: {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  } satisfies InteractionDispatchPolicy,

  async execute(
    interaction: ChatInputCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    const { channelId, guildId, user } = interaction;

    if (!guildId) {
      return responder.respond({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    await setUserChannelInCharacterMode({
      guildId,
      channelId,
      userId: user.id,
      isIc: false,
    });

    return responder.respond({
      content: appendNudge(
        '✅ You are now out-of-character in this channel. Your messages here will no longer be proxied.',
        buildNudge({ userId: user.id, guildId, isInIC: false }, 'ooc'),
      ),
      ephemeral: true,
    });
  },
};
