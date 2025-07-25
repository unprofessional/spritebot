// src/handlers/modal_handlers/inventory_modals.ts

import type { ModalSubmitInteraction } from 'discord.js';
import { createItem } from '../../services/inventory.service';

/**
 * Handles modals related to inventory item creation.
 */
export async function handle(interaction: ModalSubmitInteraction): Promise<void> {
  const { customId } = interaction;

  if (!customId.startsWith('addInventoryModal:')) return;

  const [, characterId] = customId.split(':');

  try {
    const name = interaction.fields.getTextInputValue('name')?.trim();
    const type = interaction.fields.getTextInputValue('type')?.trim() || null;
    const description = interaction.fields.getTextInputValue('description')?.trim() || null;

    if (!name || name.length > 100) {
      await interaction.reply({
        content: '⚠️ Invalid item name.',
        ephemeral: true,
      });
      return;
    }

    const item = await createItem(characterId, {
      name,
      type,
      description,
      equipped: false,
    });

    await interaction.reply({
      content: `✅ Added **${item.name}** to inventory.`,
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
