import type { ModalSubmitInteraction } from 'discord.js';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';
import {
  createGameEntityInventoryItem,
  getGameEntity,
  updateGameEntityMeta,
  updateGameEntityStat,
} from '../../services/game_entity.service';
import { build as buildEntityCard, buildInventory } from '../../components/view_game_entity_card';

export async function handle(
  interaction: ModalSubmitInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [action, entityId, scope, field] = interaction.customId.split(':');
  try {
    if (action === 'editGameEntityModal') {
      const value = interaction.fields.getTextInputValue('value').trim();
      const updated =
        scope === 'stat'
          ? (await updateGameEntityStat(entityId, interaction.user.id, field, value),
            await getGameEntity(entityId))
          : await updateGameEntityMeta(entityId, interaction.user.id, { [field]: value || null });
      if (!updated) {
        await responder.respond({ content: '⚠️ Entity no longer exists.', ephemeral: true });
        return;
      }
      await responder.respond({
        ...buildEntityCard(updated, true),
        content: '✅ Entity updated.',
      });
      return;
    }

    if (action === 'addGameEntityInventoryModal') {
      const name = interaction.fields.getTextInputValue('name').trim();
      const type = interaction.fields.getTextInputValue('type').trim() || null;
      const description = interaction.fields.getTextInputValue('description').trim() || null;
      const rawQuantity = interaction.fields.getTextInputValue('quantity').trim();
      const quantity = rawQuantity ? Number(rawQuantity) : 1;
      await createGameEntityInventoryItem(entityId, interaction.user.id, {
        name,
        type,
        description,
        quantity,
      });
      const entity = await getGameEntity(entityId);
      if (!entity) {
        await responder.respond({ content: '⚠️ Entity no longer exists.', ephemeral: true });
        return;
      }
      await responder.respond({ ...buildInventory(entity), content: `✅ Added **${name}**.` });
      return;
    }

    await responder.respond({ content: '❓ Unknown entity editor.', ephemeral: true });
  } catch (error) {
    console.error('[game_entity_modals]', error);
    await responder.respond({ content: '❌ Failed to update the entity.', ephemeral: true });
  }
}
