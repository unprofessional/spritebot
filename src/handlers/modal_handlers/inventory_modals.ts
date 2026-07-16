// src/handlers/modal_handlers/inventory_modals.ts

import type { ModalSubmitInteraction } from 'discord.js';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';
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
export async function handle(
  interaction: ModalSubmitInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const { customId } = interaction;

  if (customId.startsWith('addInventoryModal:')) {
    await handleAddInventoryModal(interaction, responder);
    return;
  }

  if (customId.startsWith('editInventoryModal:')) {
    await handleEditInventoryModal(interaction, responder);
  }
}

async function handleAddInventoryModal(
  interaction: ModalSubmitInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [, characterId, rawPage] = interaction.customId.split(':');

  try {
    const ownsCharacter = await belongsToUser(characterId, interaction.user.id);
    if (!ownsCharacter) {
      await responder.respond({
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
      await responder.respond({
        content: '⚠️ Invalid item name.',
        ephemeral: true,
      });
      return;
    }

    if (quantity === null) {
      await responder.respond({
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
      responder,
      characterId,
      page,
      `✅ Added **${item.name}**${item.quantity > 1 ? ` x${item.quantity}` : ''}.`,
    );
  } catch (err) {
    console.error('[addInventoryModal] Error:', err);
    await responder.respond({
      content: '❌ Failed to add inventory item.',
      ephemeral: true,
    });
  }
}

async function handleEditInventoryModal(
  interaction: ModalSubmitInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [, characterId, itemId, rawPage] = interaction.customId.split(':');

  try {
    const ownsCharacter = await belongsToUser(characterId, interaction.user.id);
    if (!ownsCharacter) {
      await responder.respond({
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
      await responder.respond({
        content: '⚠️ Invalid item name.',
        ephemeral: true,
      });
      return;
    }

    if (quantity === null) {
      await responder.respond({
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
      await responder.respond({
        content: '❌ Inventory item not found.',
        ephemeral: true,
      });
      return;
    }

    const character = await getCharacterWithInventory(characterId);
    if (!character) {
      await responder.respond({
        content: `✅ Updated **${item.name}**.`,
        ephemeral: true,
      });
      return;
    }

    const page = parseInt(rawPage, 10) || 0;
    await updateInventoryModalMessage(
      interaction,
      responder,
      characterId,
      page,
      `✅ Updated **${item.name}**${item.quantity > 1 ? ` x${item.quantity}` : ''}.`,
    );
  } catch (err) {
    console.error('[editInventoryModal] Error:', err);
    await responder.respond({
      content: '❌ Failed to update inventory item.',
      ephemeral: true,
    });
  }
}

async function updateInventoryModalMessage(
  interaction: ModalSubmitInteraction,
  responder: DiscordInteractionResponder,
  characterId: string,
  page: number,
  content: string,
): Promise<void> {
  const character = await getCharacterWithInventory(characterId);
  if (!character) {
    await responder.respond({
      content,
      ephemeral: true,
    });
    return;
  }

  const { embeds, components } = buildInventoryCard(character, page);

  await responder.respond({
    content,
    embeds,
    components,
    ...(interaction.message ? {} : { ephemeral: true }),
  });
}

function parseQuantity(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;

  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return null;

  return quantity;
}
