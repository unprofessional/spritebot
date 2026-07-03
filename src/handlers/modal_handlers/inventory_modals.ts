// src/handlers/modal_handlers/inventory_modals.ts

import type { ModalMessageModalSubmitInteraction, ModalSubmitInteraction } from 'discord.js';
import { build as buildInventoryCard } from '../../components/view_inventory_card';
import { belongsToUser } from '../../services/character.service';
import {
  createItem,
  getCharacterWithInventory,
  updateItem,
} from '../../services/inventory.service';

/**
 * Handles modals related to inventory item creation.
 */
export async function handle(interaction: ModalSubmitInteraction): Promise<void> {
  const { customId } = interaction;

  if (customId.startsWith('addInventoryModal:')) {
    await handleAddInventoryModal(interaction);
    return;
  }

  if (customId.startsWith('editInventoryModal:')) {
    await handleEditInventoryModal(interaction);
  }
}

async function handleAddInventoryModal(interaction: ModalSubmitInteraction): Promise<void> {
  const [, characterId, rawPage] = interaction.customId.split(':');

  try {
    const ownsCharacter = await belongsToUser(characterId, interaction.user.id);
    if (!ownsCharacter) {
      await interaction.reply({
        content: '❌ You can only manage inventory for your own characters.',
        ephemeral: true,
      });
      return;
    }

    const name = interaction.fields.getTextInputValue('name')?.trim();
    const type = interaction.fields.getTextInputValue('type')?.trim() || null;
    const quantityInput = interaction.fields.getTextInputValue('quantity')?.trim() || '1';
    const description = interaction.fields.getTextInputValue('description')?.trim() || null;
    const quantity = parseQuantity(quantityInput);

    if (!name || name.length > 100) {
      await interaction.reply({
        content: '⚠️ Invalid item name.',
        ephemeral: true,
      });
      return;
    }

    if (quantity === null) {
      await interaction.reply({
        content: '⚠️ Quantity must be a positive whole number.',
        ephemeral: true,
      });
      return;
    }

    const item = await createItem(characterId, {
      name,
      type,
      description,
      quantity,
      equipped: false,
    });

    const page = parseInt(rawPage, 10) || 0;
    await updateInventoryModalMessage(
      interaction,
      characterId,
      page,
      `✅ Added **${item.name}**${item.quantity > 1 ? ` x${item.quantity}` : ''}.`,
    );
  } catch (err) {
    console.error('[addInventoryModal] Error:', err);
    await interaction.reply({
      content: '❌ Failed to add inventory item.',
      ephemeral: true,
    });
  }
}

async function handleEditInventoryModal(interaction: ModalSubmitInteraction): Promise<void> {
  const [, characterId, itemId, rawPage] = interaction.customId.split(':');

  try {
    const ownsCharacter = await belongsToUser(characterId, interaction.user.id);
    if (!ownsCharacter) {
      await interaction.reply({
        content: '❌ You can only manage inventory for your own characters.',
        ephemeral: true,
      });
      return;
    }

    const name = interaction.fields.getTextInputValue('name')?.trim();
    const type = interaction.fields.getTextInputValue('type')?.trim() || null;
    const quantityInput = interaction.fields.getTextInputValue('quantity')?.trim() || '1';
    const description = interaction.fields.getTextInputValue('description')?.trim() || null;
    const quantity = parseQuantity(quantityInput);

    if (!name || name.length > 100) {
      await interaction.reply({
        content: '⚠️ Invalid item name.',
        ephemeral: true,
      });
      return;
    }

    if (quantity === null) {
      await interaction.reply({
        content: '⚠️ Quantity must be a positive whole number.',
        ephemeral: true,
      });
      return;
    }

    const item = await updateItem(characterId, itemId, {
      name,
      type,
      description,
      quantity,
    });

    if (!item) {
      await interaction.reply({
        content: '❌ Inventory item not found.',
        ephemeral: true,
      });
      return;
    }

    const character = await getCharacterWithInventory(characterId);
    if (!character) {
      await interaction.reply({
        content: `✅ Updated **${item.name}**.`,
        ephemeral: true,
      });
      return;
    }

    const page = parseInt(rawPage, 10) || 0;
    await updateInventoryModalMessage(
      interaction,
      characterId,
      page,
      `✅ Updated **${item.name}**${item.quantity > 1 ? ` x${item.quantity}` : ''}.`,
    );
  } catch (err) {
    console.error('[editInventoryModal] Error:', err);
    await interaction.reply({
      content: '❌ Failed to update inventory item.',
      ephemeral: true,
    });
  }
}

async function updateInventoryModalMessage(
  interaction: ModalSubmitInteraction,
  characterId: string,
  page: number,
  content: string,
): Promise<void> {
  const character = await getCharacterWithInventory(characterId);
  if (!character) {
    await interaction.reply({
      content,
      ephemeral: true,
    });
    return;
  }

  const { embeds, components } = buildInventoryCard(character, page);

  if (interaction.message) {
    await (interaction as ModalMessageModalSubmitInteraction).update({
      content,
      embeds,
      components,
    });
    return;
  }

  await interaction.reply({
    content,
    embeds,
    components,
    ephemeral: true,
  });
}

function parseQuantity(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;

  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return null;

  return quantity;
}
