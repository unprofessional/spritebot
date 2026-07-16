// src/commands/restore-character.ts

import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { build as buildRestoreCharacterSelector } from '../components/restore_character_selector';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restore-character')
    .setDescription('Restore one of your recently deleted characters in your current game.'),

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

    const response = await buildRestoreCharacterSelector(user.id, guildId);
    return responder.respond(response);
  },
};
