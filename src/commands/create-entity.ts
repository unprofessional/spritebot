import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';
import { createGameEntity } from '../services/game_entity.service';
import { getCurrentGame } from '../services/player.service';
import type { GameEntityKind, GameEntityVisibility } from '../types/game_entity';
import { build as buildEntityCard } from '../components/view_game_entity_card';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('create-entity')
    .setDescription('Create a game-owned NPC or creature.')
    .addStringOption((option) =>
      option
        .setName('kind')
        .setDescription('What kind of entity to create')
        .setRequired(true)
        .addChoices({ name: 'NPC', value: 'npc' }, { name: 'Creature', value: 'creature' }),
    )
    .addStringOption((option) =>
      option.setName('name').setDescription('Entity name').setRequired(true).setMaxLength(100),
    )
    .addStringOption((option) =>
      option
        .setName('bio')
        .setDescription('Short biography or description')
        .setRequired(false)
        .setMaxLength(1000),
    )
    .addStringOption((option) =>
      option.setName('avatar').setDescription('Avatar image URL').setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('visibility')
        .setDescription('Who can discover this entity')
        .setRequired(false)
        .addChoices(
          { name: 'Private', value: 'private' },
          { name: 'Link-only', value: 'link-only' },
          { name: 'Public', value: 'public' },
        ),
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
    const gameId = await getCurrentGame(interaction.user.id, interaction.guildId);
    if (!gameId) {
      return responder.respond({
        content: '⚠️ Select a game with `/switch-game` before creating an entity.',
        ephemeral: true,
      });
    }
    try {
      const entity = await createGameEntity({
        requesterId: interaction.user.id,
        gameId,
        kind: interaction.options.getString('kind', true) as GameEntityKind,
        name: interaction.options.getString('name', true),
        bio: interaction.options.getString('bio'),
        avatar_url: interaction.options.getString('avatar'),
        visibility: (interaction.options.getString('visibility') ||
          'private') as GameEntityVisibility,
      });
      return responder.respond({
        ...buildEntityCard(entity, true),
        content: `✅ Created ${entity.kind === 'npc' ? 'NPC' : 'creature'} **${entity.name}**.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('[create-entity]', error);
      return responder.respond({
        content: '❌ Only the active game’s creator can create NPCs or creatures.',
        ephemeral: true,
      });
    }
  },
};
