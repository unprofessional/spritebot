import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import { getGame } from '../services/game.service';
import { getGameEntity } from '../services/game_entity.service';
import type { GameEntity } from '../types/game_entity';
import { build as buildEntityCard } from './view_game_entity_card';

export const id = 'selectGameEntity';
export const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

export function build(entities: GameEntity[]) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder('Choose an NPC or creature')
      .addOptions(
        entities.slice(0, 25).map((entity) => ({
          label: entity.name.slice(0, 100),
          value: entity.id,
          description: `${entity.kind === 'npc' ? 'NPC' : 'Creature'} • ${entity.visibility}`,
        })),
      ),
  );
}

export async function handle(
  interaction: StringSelectMenuInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const entityId = interaction.values[0];
  const entity = entityId ? await getGameEntity(entityId) : null;
  if (!entity) {
    await responder.respond({ content: '⚠️ That entity is no longer available.', components: [] });
    return;
  }

  const game = await getGame({ id: entity.game_id });
  const canManage = game?.created_by === interaction.user.id;
  if (!canManage && entity.visibility !== 'public') {
    await responder.respond({
      content: '❌ That entity is not publicly discoverable.',
      embeds: [],
      components: [],
    });
    return;
  }

  await responder.respond({ ...buildEntityCard(entity, canManage), content: null });
}
