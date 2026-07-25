import type { StringSelectMenuInteraction } from 'discord.js';
import type { InteractionDispatchPolicy } from '../../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';
import {
  canManageGameEntity,
  getGameEntity,
  getGameEntityInventory,
} from '../../services/game_entity.service';
import { buildInventoryItemActions } from '../../components/view_game_entity_card';

export const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

export async function handle(
  interaction: StringSelectMenuInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const entityId = interaction.customId.split(':')[1];
  const itemId = interaction.values[0];
  if (!(await canManageGameEntity(entityId, interaction.user.id))) {
    await responder.respond({ content: '❌ You cannot manage that inventory.', components: [] });
    return;
  }
  const entity = await getGameEntity(entityId);
  const item = (await getGameEntityInventory(entityId)).find((entry) => entry.id === itemId);
  if (!entity || !item) {
    await responder.respond({ content: '⚠️ Inventory item not found.', components: [] });
    return;
  }
  await responder.respond({ ...buildInventoryItemActions(entityId, item), content: null });
}
