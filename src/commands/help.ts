import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { build as buildHelpLandingCard } from '../components/help/help_landing_card';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Find the SPRITE commands that matter to you.'),

  interactionPolicy: {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  } satisfies InteractionDispatchPolicy,

  async execute(
    _interaction: ChatInputCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    return responder.respond({ ...buildHelpLandingCard() });
  },
};
