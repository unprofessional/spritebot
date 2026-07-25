import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
} from 'discord.js';
import {
  gatedImmediateModalInteractionPolicy,
  type InteractionDispatchPolicy,
} from '../../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';
import {
  canManageGameEntity,
  deleteGameEntity,
  deleteGameEntityInventoryItem,
  getGameEntity,
  setGameEntityInventoryEquipped,
  updateGameEntityMeta,
} from '../../services/game_entity.service';
import {
  build as buildEntityCard,
  buildInventory,
  buildInventoryItemActions,
} from '../../components/view_game_entity_card';
import { build as buildEntityFieldSelector } from '../../components/game_entity_field_selector';

export const componentUpdatePolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

export function getInteractionPolicy(customId: string): InteractionDispatchPolicy {
  if (customId.startsWith('addGameEntityInventory:')) {
    return gatedImmediateModalInteractionPolicy;
  }
  return componentUpdatePolicy;
}

export async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [action, entityId, itemId, mode] = interaction.customId.split(':');

  try {
    if (action === 'backToGameEntity') {
      await showEntity(entityId, interaction.user.id, responder);
      return;
    }

    if (action === 'editGameEntity') {
      await assertManager(entityId, interaction.user.id);
      const entity = await getGameEntity(entityId);
      if (!entity) return missing(responder);
      await responder.respond({
        ...buildEntityCard(entity, true),
        content: '✏️ Choose a field to edit.',
        components: [buildEntityFieldSelector(entity)],
      });
      return;
    }

    if (action === 'toggleGameEntityVisibility') {
      await assertManager(entityId, interaction.user.id);
      const entity = await getGameEntity(entityId);
      if (!entity) return missing(responder);
      const visibility =
        entity.visibility === 'private'
          ? 'link-only'
          : entity.visibility === 'link-only'
            ? 'public'
            : 'private';
      const updated = await updateGameEntityMeta(entityId, interaction.user.id, { visibility });
      if (!updated) return missing(responder);
      await responder.respond({
        ...buildEntityCard(updated, true),
        content: `✅ Visibility set to **${visibility}**.`,
      });
      return;
    }

    if (action === 'viewGameEntityInventory') {
      await assertManager(entityId, interaction.user.id);
      const entity = await getGameEntity(entityId);
      if (!entity) return missing(responder);
      await responder.respond({ ...buildInventory(entity), content: null });
      return;
    }

    if (action === 'addGameEntityInventory') {
      await assertManager(entityId, interaction.user.id);
      const modal = new ModalBuilder()
        .setCustomId(`addGameEntityInventoryModal:${entityId}`)
        .setTitle('Add Entity Inventory Item')
        .addComponents(
          textRow('name', 'Item Name', true),
          textRow('type', 'Type / Category', false),
          textRow('quantity', 'Quantity', false, TextInputStyle.Short, '1'),
          textRow('description', 'Description', false, TextInputStyle.Paragraph),
        );
      await responder.showModal(modal);
      return;
    }

    if (action === 'equipGameEntityInventory') {
      const updated = await setGameEntityInventoryEquipped(
        entityId,
        interaction.user.id,
        itemId,
        mode === 'on',
      );
      if (!updated) return missing(responder);
      await responder.respond({
        ...buildInventoryItemActions(entityId, updated),
        content: updated.equipped ? '✅ Item equipped.' : '▫️ Item unequipped.',
      });
      return;
    }

    if (action === 'deleteGameEntityInventory') {
      await deleteGameEntityInventoryItem(entityId, interaction.user.id, itemId);
      const entity = await getGameEntity(entityId);
      if (!entity) return missing(responder);
      await responder.respond({ ...buildInventory(entity), content: '🗑️ Inventory item deleted.' });
      return;
    }

    if (action === 'deleteGameEntity') {
      const entity = await getGameEntity(entityId);
      if (!entity) return missing(responder);
      await assertManager(entityId, interaction.user.id);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirmDeleteGameEntity:${entityId}`)
          .setLabel('Confirm Delete')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`backToGameEntity:${entityId}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      );
      await responder.respond({
        content: `🗑️ Delete **${entity.name}**? You can restore it for 30 days.`,
        embeds: [],
        components: [row],
      });
      return;
    }

    if (action === 'confirmDeleteGameEntity') {
      const deleted = await deleteGameEntity(entityId, interaction.user.id);
      await responder.respond({
        content: deleted
          ? '🗑️ Entity deleted. Use `/restore-entity` within 30 days to recover it.'
          : '⚠️ Entity was already deleted.',
        embeds: [],
        components: [],
      });
      return;
    }

    await responder.respond({ content: '❓ Unknown entity action.', ephemeral: true });
  } catch (error) {
    console.error('[game_entity_buttons]', error);
    await responder.respond({
      content: '❌ You cannot manage that NPC or creature.',
      ephemeral: true,
    });
  }
}

async function showEntity(
  entityId: string,
  requesterId: string,
  responder: DiscordInteractionResponder,
) {
  const entity = await getGameEntity(entityId);
  if (!entity) return missing(responder);
  await assertManager(entityId, requesterId);
  await responder.respond({ ...buildEntityCard(entity, true), content: null });
}

async function assertManager(entityId: string, requesterId: string): Promise<void> {
  if (!(await canManageGameEntity(entityId, requesterId))) {
    throw new Error('Only the game creator can manage entities.');
  }
}

async function missing(responder: DiscordInteractionResponder) {
  await responder.respond({
    content: '⚠️ That NPC or creature is no longer available.',
    embeds: [],
    components: [],
  });
}

function textRow(
  id: string,
  label: string,
  required: boolean,
  style = TextInputStyle.Short,
  placeholder?: string,
) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setRequired(required)
    .setStyle(style);
  if (placeholder) input.setPlaceholder(placeholder);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}
