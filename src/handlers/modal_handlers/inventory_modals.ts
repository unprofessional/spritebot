// src/handlers/modal_handlers/inventory_modals.ts

import type { ModalSubmitInteraction } from 'discord.js';
import { belongsToUser } from '../../services/character.service';
import { createItem } from '../../services/inventory.service';

/**
 * Handles modals related to inventory item creation.
 */
export async function handle(interaction: ModalSubmitInteraction): Promise<void> {
  const { customId } = interaction;

  if (!customId.startsWith('addInventoryModal:')) return;

  const [, characterId] = customId.split(':');

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

    await interaction.reply({
      content: `✅ Added **${item.name}**${item.quantity > 1 ? ` x${item.quantity}` : ''} to inventory.`,
      ephemeral: true,
    });
  } catch (err) {
    console.error('[addInventoryModal] Error:', err);
    await interaction.reply({
      content: '❌ Failed to add inventory item.',
      ephemeral: true,
    });
  }
}

function parseQuantity(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;

  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return null;

  return quantity;
}
