import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import type { InteractionDispatchPolicy } from '../discord/interaction_dispatch';
import { getRestorableGameEntities, restoreGameEntity } from '../services/game_entity.service';
import type { GameEntity } from '../types/game_entity';

export const id = 'restoreGameEntityDropdown';
export const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

export function build(entities: GameEntity[]) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder('Choose an entity to restore')
    .addOptions(
      entities.slice(0, 25).map((entity) => ({
        label: entity.name.slice(0, 100),
        value: entity.id,
        description: entity.kind === 'npc' ? 'NPC' : 'Creature',
      })),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export async function buildForGame(gameId: string, requesterId: string) {
  const entities = await getRestorableGameEntities(gameId, requesterId);
  if (!entities.length) {
    return {
      content: '📭 No NPCs or creatures are available to restore in this game.',
      components: [],
      ephemeral: true,
    };
  }
  return {
    content: '♻️ Choose an NPC or creature to restore. Restored entities return as private.',
    components: [build(entities)],
    ephemeral: true,
  };
}

export async function handle(
  interaction: StringSelectMenuInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const entityId = interaction.values[0];
  if (!entityId) {
    await responder.respond({ content: '⚠️ No entity selected.', components: [] });
    return;
  }
  const result = await restoreGameEntity(entityId, interaction.user.id);
  if (!result.ok) {
    await responder.respond({
      content:
        result.reason === 'expired'
          ? '⚠️ That entity is outside the 30-day restore window.'
          : '⚠️ That entity can no longer be restored.',
      components: [],
    });
    return;
  }
  await responder.respond({
    content: `✅ Restored **${result.entity.name}** as a private ${result.entity.kind}.`,
    components: [],
  });
}
