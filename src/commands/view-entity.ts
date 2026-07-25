import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { build as buildEntitySelector } from '../components/game_entity_selector';
import { build as buildEntityCard } from '../components/view_game_entity_card';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';
import { getGame } from '../services/game.service';
import { getGameEntities, getGameEntity } from '../services/game_entity.service';
import { getCurrentGame } from '../services/player.service';
import { isUuid } from '../utils/uuid';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('view-entity')
    .setDescription('View an NPC or creature in your current game.')
    .addStringOption((option) =>
      option
        .setName('entity_id')
        .setDescription('Direct entity ID, including link-only entities')
        .setRequired(false),
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
      const game = await getGame({ id: gameId });
      const canManage = game?.created_by === interaction.user.id;
      const entityId = interaction.options.getString('entity_id');
      if (entityId) {
        if (!isUuid(entityId)) {
          return responder.respond({
            content: '⚠️ Entity ID must be a valid UUID.',
            ephemeral: true,
          });
        }
        const entity = await getGameEntity(entityId);
        if (
          !entity ||
          entity.game_id !== gameId ||
          (!canManage && entity.visibility === 'private')
        ) {
          return responder.respond({
            content: '⚠️ That entity is not available in your current game.',
            ephemeral: true,
          });
        }
        return responder.respond({
          ...buildEntityCard(entity, canManage),
          ephemeral: true,
        });
      }

      const entities = await getGameEntities(gameId);
      const visible = canManage
        ? entities
        : entities.filter((entity) => entity.visibility === 'public');
      if (!visible.length) {
        return responder.respond({
          content: '📭 No discoverable NPCs or creatures are available.',
          ephemeral: true,
        });
      }
      return responder.respond({
        content: '🧭 Choose an NPC or creature to view.',
        components: [buildEntitySelector(visible)],
        ephemeral: true,
      });
    } catch (error) {
      console.error('[view-entity]', error);
      return responder.respond({
        content: '❌ Failed to load NPCs or creatures. Please try again later.',
        ephemeral: true,
      });
    }
  },
};
