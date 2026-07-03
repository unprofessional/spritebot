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
  deleteInventoryByCharacter,
  getCharacterWithInventory,
} from '../../services/inventory.service';

export async function handle(interaction: ButtonInteraction): Promise<void> {
  const { customId } = interaction;

  if (customId.startsWith('add_inventory_item:')) {
    const [, characterId] = customId.split(':');

    if (!(await canUseInventory(interaction, characterId))) return;

    const modal = new ModalBuilder()
      .setCustomId(`addInventoryModal:${characterId}`)
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

  if (customId.startsWith('clear_inventory:')) {
    const [, characterId] = customId.split(':');

    if (!(await canUseInventory(interaction, characterId))) return;

    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirm_clear_inventory:${characterId}`)
        .setLabel('Yes, Delete All Items')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('cancel_clear_inventory')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      content: '⚠️ Are you sure you want to delete all inventory items for this character?',
      components: [confirmRow],
      ephemeral: true,
    });
    return;
  }

  if (customId.startsWith('confirm_clear_inventory:')) {
    const [, characterId] = customId.split(':');
    try {
      if (!(await canUseInventory(interaction, characterId))) return;

      await deleteInventoryByCharacter(characterId);
      await interaction.update({
        content: '🗑️ Inventory cleared.',
        components: [],
      });
    } catch (err) {
      console.error('Error clearing inventory:', err);
      await interaction.update({
        content: '❌ Failed to clear inventory.',
        components: [],
      });
    }
    return;
  }

  if (customId === 'cancel_clear_inventory') {
    await interaction.update({
      content: '❎ Inventory deletion cancelled.',
      components: [],
    });
    return;
  }
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
