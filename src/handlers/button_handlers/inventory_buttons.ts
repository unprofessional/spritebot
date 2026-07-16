// src/handlers/button_handlers/inventory_buttons.ts

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
} from 'discord.js';

import { build as buildInventoryCard } from '../../components/view_inventory_card';
import {
  gatedPreparedModalInteractionPolicy,
  type InteractionDispatchPolicy,
} from '../../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';
import { presentPreparedModal } from '../../discord/prepared_modal';
import { belongsToUser } from '../../services/character.service';
import {
  deleteItemForCharacter,
  deleteInventoryByCharacter,
  getCharacterWithInventory,
  setEquippedForCharacter,
} from '../../services/inventory.service';
import { buildEditModal } from '../select_menu_handlers/inventory_item_select';

export const interactionPolicy = gatedPreparedModalInteractionPolicy;
const componentUpdateInteractionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;
const viewInventoryInteractionPolicy = {
  mode: { kind: 'reply', visibility: 'ephemeral' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

export function getInteractionPolicy(customId: string): InteractionDispatchPolicy {
  if (/^(?:add_inventory_item|invEdit|edit_inventory_item):/.test(customId)) {
    return interactionPolicy;
  }
  if (customId.startsWith('view_inventory:')) return viewInventoryInteractionPolicy;
  return componentUpdateInteractionPolicy;
}

export async function handle(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const { customId } = interaction;

  if (customId.startsWith('add_inventory_item:')) {
    const [, characterId, rawPage] = customId.split(':');

    if (!(await canUseInventory(interaction, responder, characterId))) return;

    const page = parseInt(rawPage, 10) || 0;
    const modal = new ModalBuilder()
      .setCustomId(`addInventoryModal:${characterId}:${page}`)
      .setTitle('Add Inventory Item')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Item Name')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('type')
            .setLabel('Item Type / Category (optional)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('quantity')
            .setLabel('Quantity')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('1'),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('description')
            .setLabel('Description (optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false),
        ),
      );

    await presentPreparedModal({ modal, responder, userId: interaction.user.id });
    return;
  }

  if (customId.startsWith('view_inventory:')) {
    const [, characterId] = customId.split(':');
    try {
      if (!(await canUseInventory(interaction, responder, characterId))) return;

      const character = await getCharacterWithInventory(characterId);

      if (!character) {
        await responder.respond({
          content: '❌ Character not found.',
          ephemeral: true,
        });
        return;
      }

      const { embeds, components } = buildInventoryCard(character);
      await responder.respond({ embeds, components, ephemeral: true });
    } catch (err) {
      console.error('Error viewing inventory:', err);
      await responder.respond({
        content: '❌ Failed to load inventory.',
        ephemeral: true,
      });
    }
    return;
  }

  if (customId.startsWith('inventoryPage:')) {
    const [, direction, characterId, rawPage] = customId.split(':');
    try {
      if (!(await canUseInventory(interaction, responder, characterId))) return;

      const character = await getCharacterWithInventory(characterId);

      if (!character) {
        await responder.respond({
          content: '❌ Character not found.',
          ephemeral: true,
        });
        return;
      }

      const currentPage = parseInt(rawPage, 10) || 0;
      const nextPage = direction === 'next' ? currentPage + 1 : Math.max(0, currentPage - 1);
      const { embeds, components } = buildInventoryCard(character, nextPage);
      await responder.respond({ embeds, components });
    } catch (err) {
      console.error('Error paging inventory:', err);
      await responder.respond({
        content: '❌ Failed to change inventory page.',
        ephemeral: true,
      });
    }
    return;
  }

  if (customId.startsWith('invEq:') || customId.startsWith('toggle_inventory_item_equipped:')) {
    const [, characterId, itemId, rawPage, mode] = customId.split(':');
    try {
      if (!(await canUseInventory(interaction, responder, characterId))) return;

      const equipped = mode === 'on';
      const item = await setEquippedForCharacter(characterId, itemId, equipped);
      if (!item) {
        await responder.respond({
          content: '❌ Inventory item not found.',
          ephemeral: true,
        });
        return;
      }

      const page = parseInt(rawPage, 10) || 0;
      await updateInventoryMessage(
        interaction,
        responder,
        characterId,
        page,
        `${equipped ? '✅ Equipped' : '▫️ Unequipped'} **${item.name}**.`,
      );
    } catch (err) {
      console.error('Error toggling inventory item equipped state:', err);
      await responder.respond({
        content: '❌ Failed to update inventory item.',
        ephemeral: true,
      });
    }
    return;
  }

  if (customId.startsWith('invEdit:') || customId.startsWith('edit_inventory_item:')) {
    const [, characterId, itemId, rawPage] = customId.split(':');
    try {
      if (!(await canUseInventory(interaction, responder, characterId))) return;

      const page = parseInt(rawPage, 10) || 0;
      await buildEditModal(responder, interaction.user.id, characterId, itemId, page);
    } catch (err) {
      console.error('Error preparing inventory item edit:', err);
      await responder.respond({
        content: '❌ Failed to edit inventory item.',
        ephemeral: true,
      });
    }
    return;
  }

  if (customId.startsWith('invDel:') || customId.startsWith('delete_inventory_item:')) {
    const [, characterId, itemId, rawPage] = customId.split(':');

    if (!(await canUseInventory(interaction, responder, characterId))) return;

    const page = parseInt(rawPage, 10) || 0;
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`invDelOk:${characterId}:${itemId}:${page}`)
        .setLabel('Yes, Delete Item')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`cancel_inventory_item_action:${characterId}:${page}`)
        .setLabel('↩️ Go Back')
        .setStyle(ButtonStyle.Secondary),
    );

    await responder.respond({
      content: '⚠️ Delete this inventory item?',
      components: [confirmRow],
    });
    return;
  }

  if (customId.startsWith('invDelOk:') || customId.startsWith('confirm_delete_inventory_item:')) {
    const [, characterId, itemId, rawPage] = customId.split(':');
    try {
      if (!(await canUseInventory(interaction, responder, characterId))) return;

      await deleteItemForCharacter(characterId, itemId);
      const page = parseInt(rawPage, 10) || 0;
      await updateInventoryMessage(
        interaction,
        responder,
        characterId,
        page,
        '🗑️ Inventory item deleted.',
      );
    } catch (err) {
      console.error('Error deleting inventory item:', err);
      await responder.respond({
        content: '❌ Failed to delete inventory item.',
        ephemeral: true,
      });
    }
    return;
  }

  if (customId.startsWith('cancel_inventory_item_action:')) {
    const [, characterId, rawPage] = customId.split(':');
    const page = parseInt(rawPage, 10) || 0;
    await updateInventoryMessage(interaction, responder, characterId, page);
    return;
  }

  if (customId.startsWith('clear_inventory:')) {
    const [, characterId, rawPage] = customId.split(':');

    if (!(await canUseInventory(interaction, responder, characterId))) return;

    const page = parseInt(rawPage, 10) || 0;
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirm_clear_inventory:${characterId}:${page}`)
        .setLabel('Yes, Delete All Items')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`cancel_clear_inventory:${characterId}:${page}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await responder.respond({
      content: '⚠️ Are you sure you want to delete all inventory items for this character?',
      components: [confirmRow],
    });
    return;
  }

  if (customId.startsWith('confirm_clear_inventory:')) {
    const [, characterId, rawPage] = customId.split(':');
    try {
      if (!(await canUseInventory(interaction, responder, characterId))) return;

      await deleteInventoryByCharacter(characterId);
      const page = parseInt(rawPage, 10) || 0;
      await updateInventoryMessage(
        interaction,
        responder,
        characterId,
        page,
        '🗑️ Inventory cleared.',
      );
    } catch (err) {
      console.error('Error clearing inventory:', err);
      await responder.respond({
        content: '❌ Failed to clear inventory.',
        components: [],
      });
    }
    return;
  }

  if (customId.startsWith('cancel_clear_inventory:')) {
    const [, characterId, rawPage] = customId.split(':');
    const page = parseInt(rawPage, 10) || 0;
    await updateInventoryMessage(interaction, responder, characterId, page);
    return;
  }
}

export async function updateInventoryMessage(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
  characterId: string,
  page = 0,
  content: string | null = null,
): Promise<void> {
  const character = await getCharacterWithInventory(characterId);
  if (!character) {
    await responder.respond({
      content: '❌ Character not found.',
      embeds: [],
      components: [],
    });
    return;
  }

  const { embeds, components } = buildInventoryCard(character, page);
  await responder.respond({
    content,
    embeds,
    components,
  });
}

async function canUseInventory(
  interaction: ButtonInteraction,
  responder: DiscordInteractionResponder,
  characterId: string | undefined,
): Promise<boolean> {
  if (!characterId) {
    const payload = {
      content: '⚠️ Invalid inventory action.',
      ephemeral: true as const,
    };
    await responder.respond(payload);
    return false;
  }

  const ownsCharacter = await belongsToUser(characterId, interaction.user.id);
  if (!ownsCharacter) {
    const payload = {
      content: '❌ You can only manage inventory for your own characters.',
      ephemeral: true as const,
    };
    await responder.respond(payload);
    return false;
  }

  return true;
}
