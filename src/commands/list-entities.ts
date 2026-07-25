import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { build as buildEntitySelector } from '../components/game_entity_selector';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';
import { getGame } from '../services/game.service';
import { getGameEntities } from '../services/game_entity.service';
import { getCurrentGame } from '../services/player.service';
import type { GameEntityKind } from '../types/game_entity';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-entities')
    .setDescription('Browse NPCs and creatures in your current game.')
    .addStringOption((option) =>
      option
        .setName('kind')
        .setDescription('Filter by entity kind')
        .setRequired(false)
        .addChoices({ name: 'NPC', value: 'npc' }, { name: 'Creature', value: 'creature' }),
    ),
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
    try {
      const gameId = await getCurrentGame(interaction.user.id, interaction.guildId);
      if (!gameId) {
        return responder.respond({
          content: '⚠️ Select a game with `/switch-game` first.',
          ephemeral: true,
        });
      }
      const [game, entities] = await Promise.all([
        getGame({ id: gameId }),
        getGameEntities(
          gameId,
          (interaction.options.getString('kind') || undefined) as GameEntityKind | undefined,
        ),
      ]);
      const canManage = game?.created_by === interaction.user.id;
      const visible = canManage
        ? entities
        : entities.filter((entity) => entity.visibility === 'public');
      if (!visible.length) {
        return responder.respond({
          content: canManage
            ? '📭 No matching NPCs or creatures exist in this game.'
            : '📭 No public NPCs or creatures are available in this game.',
          ephemeral: true,
        });
      }
      return responder.respond({
        content: canManage
          ? '🧭 Choose an NPC or creature. Private and link-only entries are visible because you manage this game.'
          : '🧭 Choose a public NPC or creature.',
        components: [buildEntitySelector(visible)],
        ephemeral: true,
      });
    } catch (error) {
      console.error('[list-entities]', error);
      return responder.respond({
        content: '❌ Failed to list NPCs or creatures. Please try again later.',
        ephemeral: true,
      });
    }
  },
};
