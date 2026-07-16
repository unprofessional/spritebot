// src/commands/join-game.ts

import { SlashCommandBuilder, ChatInputCommandInteraction, CacheType } from 'discord.js';

import { build as buildJoinGameSelector } from '../components/join_game_selector';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('join-game')
    .setDescription('Select a public game in this server to join.'),

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
        content: '⚠️ You must use this command in a server (not DMs).',
        ephemeral: true,
      });
    }

    const response = await buildJoinGameSelector(user.id, guild.id);
    return responder.respond(response);
  },
};
