import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { supportInviteUrl } from '../config/env_config';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('support')
    .setDescription('Get an invite to the SPRITEbot support server.'),

  interactionPolicy: {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  } satisfies InteractionDispatchPolicy,

  async execute(
    _interaction: ChatInputCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    return responder.respond({
      content: `Need help or want to report a bug? Join the SPRITEbot support server: ${supportInviteUrl}`,
      ephemeral: true,
    });
  },
};
