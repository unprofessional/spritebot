import type { ModalSubmitInteraction } from 'discord.js';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';
import {
  canManageGameEntity,
  createGameEntityInventoryItem,
  getGameEntity,
  updateGameEntityMeta,
  updateGameEntityStat,
  updateGameEntityCustomField,
} from '../../services/game_entity.service';
import { build as buildEntityCard, buildInventory } from '../../components/view_game_entity_card';
import { parseCountDefault } from '../../utils/count_stat_defaults';

export async function handle(
  interaction: ModalSubmitInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [action, entityId, scope, field] = interaction.customId.split(':');
  try {
    if (action === 'editGameEntityModal') {
      const managedEntity =
        scope === 'stat' && (await canManageGameEntity(entityId, interaction.user.id))
          ? await getGameEntity(entityId)
          : null;
      const managedStat = managedEntity?.stats.find((entry) => entry.template_id === field);
      if (scope === 'stat' && managedStat?.field_type === 'count') {
        const max = parseCountDefault(interaction.fields.getTextInputValue(`${field}:max`));
        const currentRaw = interaction.fields.getTextInputValue(`${field}:current`);
        const current = currentRaw.trim() ? parseCountDefault(currentRaw) : max;
        if (max === null || current === null) {
          await responder.respond({
            content: '⚠️ Count values must be non-negative whole numbers.',
            ephemeral: true,
          });
          return;
        }
        await updateGameEntityStat(entityId, interaction.user.id, field, managedStat.value ?? '', {
          ...(managedStat.meta ?? {}),
          max,
          current,
        });
        const updated = await getGameEntity(entityId);
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

      const value = interaction.fields.getTextInputValue('value').trim();
      const updated =
        scope === 'stat'
          ? (await updateGameEntityStat(entityId, interaction.user.id, field, value),
            await getGameEntity(entityId))
          : scope === 'custom'
            ? await updateExistingCustomField(entityId, interaction.user.id, field, value)
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

    if (action === 'editGameEntityCustomModal') {
      const name = interaction.fields.getTextInputValue('name').trim();
      const value = interaction.fields.getTextInputValue('value').trim();
      if (!name || !value) {
        await responder.respond({
          content: '⚠️ Custom field name and value are required.',
          ephemeral: true,
        });
        return;
      }
      await updateGameEntityCustomField(entityId, interaction.user.id, name, value);
      const entity = await getGameEntity(entityId);
      if (!entity) {
        await responder.respond({ content: '⚠️ Entity no longer exists.', ephemeral: true });
        return;
      }
      await responder.respond({
        ...buildEntityCard(entity, true),
        content: `✅ Added custom field **${name}**.`,
      });
      return;
    }

    if (action === 'addGameEntityInventoryModal') {
      const name = interaction.fields.getTextInputValue('name').trim();
      const type = interaction.fields.getTextInputValue('type').trim() || null;
      const description = interaction.fields.getTextInputValue('description').trim() || null;
      const rawQuantity = interaction.fields.getTextInputValue('quantity').trim();
      const quantity = rawQuantity ? Number(rawQuantity) : 1;
      if (!Number.isInteger(quantity) || quantity < 1) {
        await responder.respond({
          content: '⚠️ Quantity must be a positive whole number.',
          ephemeral: true,
        });
        return;
      }
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

async function updateExistingCustomField(
  entityId: string,
  requesterId: string,
  customFieldId: string,
  value: string,
) {
  const entity = await getGameEntity(entityId);
  const customField = entity?.customFields.find((field) => field.id === customFieldId);
  if (!customField) return null;
  await updateGameEntityCustomField(
    entityId,
    requesterId,
    customField.name,
    value,
    customField.meta,
  );
  return getGameEntity(entityId);
}
