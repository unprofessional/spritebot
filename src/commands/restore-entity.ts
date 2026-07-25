import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { buildForGame } from '../components/restore_game_entity_selector';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';
import { getCurrentGame } from '../services/player.service';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restore-entity')
    .setDescription('Restore a recently deleted NPC or creature in your current game.'),
  interactionPolicy: {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  } satisfies InteractionDispatchPolicy,
  async execute(
    interaction: ChatInputCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    if (!interaction.guildId) {
      return responder.respond({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }
    const gameId = await getCurrentGame(interaction.user.id, interaction.guildId);
    if (!gameId) {
      return responder.respond({
        content: '⚠️ Select a game with `/switch-game` first.',
        ephemeral: true,
      });
    }
    try {
      return responder.respond(await buildForGame(gameId, interaction.user.id));
    } catch (error) {
      console.error('[restore-entity]', error);
      return responder.respond({
        content: '❌ Only the active game’s creator can restore its NPCs or creatures.',
        ephemeral: true,
      });
    }
  },
};
