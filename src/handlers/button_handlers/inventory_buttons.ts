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
import { belongsToUser } from '../../services/character.service';
import {
  deleteItemForCharacter,
  deleteInventoryByCharacter,
  getCharacterWithInventory,
} from '../../services/inventory.service';
import { buildEditModal } from '../select_menu_handlers/inventory_item_select';

export async function handle(interaction: ButtonInteraction): Promise<void> {
  const { customId } = interaction;

  if (customId.startsWith('add_inventory_item:')) {
    const [, characterId, rawPage] = customId.split(':');

    if (!(await canUseInventory(interaction, characterId))) return;

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

    await interaction.showModal(modal);
    return;
  }

  if (customId.startsWith('view_inventory:')) {
    const [, characterId] = customId.split(':');
    try {
      if (!(await canUseInventory(interaction, characterId))) return;

      const character = await getCharacterWithInventory(characterId);

      if (!character) {
        await interaction.reply({
          content: '❌ Character not found.',
          ephemeral: true,
        });
        return;
      }

      const { embeds, components } = buildInventoryCard(character);
      await interaction.reply({ embeds, components, ephemeral: true });
    } catch (err) {
      console.error('Error viewing inventory:', err);
      await interaction.reply({
        content: '❌ Failed to load inventory.',
        ephemeral: true,
      });
    }
    return;
  }

  if (customId.startsWith('inventoryPage:')) {
    const [, direction, characterId, rawPage] = customId.split(':');
    try {
      if (!(await canUseInventory(interaction, characterId))) return;

      const character = await getCharacterWithInventory(characterId);

      if (!character) {
        await interaction.reply({
          content: '❌ Character not found.',
          ephemeral: true,
        });
        return;
      }

      const currentPage = parseInt(rawPage, 10) || 0;
      const nextPage = direction === 'next' ? currentPage + 1 : Math.max(0, currentPage - 1);
      const { embeds, components } = buildInventoryCard(character, nextPage);
      await interaction.update({ embeds, components });
    } catch (err) {
      console.error('Error paging inventory:', err);
      await interaction.reply({
        content: '❌ Failed to change inventory page.',
        ephemeral: true,
      });
    }
    return;
  }

  if (customId.startsWith('edit_inventory_item:')) {
    const [, characterId, itemId, rawPage] = customId.split(':');
    try {
      if (!(await canUseInventory(interaction, characterId))) return;

      const page = parseInt(rawPage, 10) || 0;
      await buildEditModal(interaction, characterId, itemId, page);
    } catch (err) {
      console.error('Error preparing inventory item edit:', err);
      await interaction.reply({
        content: '❌ Failed to edit inventory item.',
        ephemeral: true,
      });
    }
    return;
  }

  if (customId.startsWith('delete_inventory_item:')) {
    const [, characterId, itemId, rawPage] = customId.split(':');

    if (!(await canUseInventory(interaction, characterId))) return;

    const page = parseInt(rawPage, 10) || 0;
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirm_delete_inventory_item:${characterId}:${itemId}:${page}`)
        .setLabel('Yes, Delete Item')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`cancel_inventory_item_action:${characterId}:${page}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.update({
      content: '⚠️ Delete this inventory item?',
      components: [confirmRow],
    });
    return;
  }

  if (customId.startsWith('confirm_delete_inventory_item:')) {
    const [, characterId, itemId, rawPage] = customId.split(':');
    try {
      if (!(await canUseInventory(interaction, characterId))) return;

      await deleteItemForCharacter(characterId, itemId);
      const page = parseInt(rawPage, 10) || 0;
      await updateInventoryMessage(interaction, characterId, page, '🗑️ Inventory item deleted.');
    } catch (err) {
      console.error('Error deleting inventory item:', err);
      await interaction.reply({
        content: '❌ Failed to delete inventory item.',
        ephemeral: true,
      });
    }
    return;
  }

  if (customId.startsWith('cancel_inventory_item_action:')) {
    const [, characterId, rawPage] = customId.split(':');
    const page = parseInt(rawPage, 10) || 0;
    await updateInventoryMessage(interaction, characterId, page);
    return;
  }

  if (customId.startsWith('clear_inventory:')) {
    const [, characterId, rawPage] = customId.split(':');

    if (!(await canUseInventory(interaction, characterId))) return;

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

    await interaction.update({
      content: '⚠️ Are you sure you want to delete all inventory items for this character?',
      components: [confirmRow],
    });
    return;
  }

  if (customId.startsWith('confirm_clear_inventory:')) {
    const [, characterId, rawPage] = customId.split(':');
    try {
      if (!(await canUseInventory(interaction, characterId))) return;

      await deleteInventoryByCharacter(characterId);
      const page = parseInt(rawPage, 10) || 0;
      await updateInventoryMessage(interaction, characterId, page, '🗑️ Inventory cleared.');
    } catch (err) {
      console.error('Error clearing inventory:', err);
      await interaction.update({
        content: '❌ Failed to clear inventory.',
        components: [],
      });
    }
    return;
  }

  if (customId.startsWith('cancel_clear_inventory:')) {
    const [, characterId, rawPage] = customId.split(':');
    const page = parseInt(rawPage, 10) || 0;
    await updateInventoryMessage(interaction, characterId, page);
    return;
  }
}

export async function updateInventoryMessage(
  interaction: ButtonInteraction,
  characterId: string,
  page = 0,
  content: string | null = null,
): Promise<void> {
  const character = await getCharacterWithInventory(characterId);
  if (!character) {
    await interaction.update({
      content: '❌ Character not found.',
      embeds: [],
      components: [],
    });
    return;
  }

  const { embeds, components } = buildInventoryCard(character, page);
  await interaction.update({
    content,
    embeds,
    components,
  });
}

async function canUseInventory(
  interaction: ButtonInteraction,
  characterId: string | undefined,
): Promise<boolean> {
  if (!characterId) {
    await interaction.reply({
      content: '⚠️ Invalid inventory action.',
      ephemeral: true,
    });
    return false;
  }

  const ownsCharacter = await belongsToUser(characterId, interaction.user.id);
  if (!ownsCharacter) {
    await interaction.reply({
      content: '❌ You can only manage inventory for your own characters.',
      ephemeral: true,
    });
    return false;
  }

  return true;
}
