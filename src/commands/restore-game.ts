import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { build as buildRestoreGameSelector } from '../components/restore_game_selector';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restore-game')
    .setDescription('Restore one of your recently deleted games in this server.'),

  interactionPolicy: {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  } satisfies InteractionDispatchPolicy,

  async execute(
    interaction: ChatInputCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    const { guildId, user } = interaction;
    if (!guildId) {
      return responder.respond({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    return responder.respond(await buildRestoreGameSelector(user.id, guildId));
  },
};
