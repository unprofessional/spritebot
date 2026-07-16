// src/commands/switch-game.ts

import { SlashCommandBuilder, ChatInputCommandInteraction, CacheType } from 'discord.js';

import { build as buildSwitchGameSelector } from '../components/switch_game_selector';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('switch-game')
    .setDescription('Select one of your games to make active.'),

  interactionPolicy: {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  } satisfies InteractionDispatchPolicy,

  async execute(
    interaction: ChatInputCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    const { user, guild } = interaction;

    if (!guild) {
      return responder.respond({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    const response = await buildSwitchGameSelector(user.id, guild.id);
    return responder.respond({ ...response });
  },
};
