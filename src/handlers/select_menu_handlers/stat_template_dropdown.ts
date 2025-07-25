// src/handlers/select_menu_handlers/stat_template_dropdown.ts

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuInteraction,
} from 'discord.js';

import { getStatTemplates, getStatTemplateById } from '../../services/game.service';
import { buildStatTemplateModal } from '../../handlers/modal_handlers/stat_template_modals';
import type { StatTemplate } from '../../types/stat_template';

/**
 * Handles stat template field selection menus (edit and delete).
 */
export async function handle(interaction: StringSelectMenuInteraction): Promise<void> {
  const { customId, values } = interaction;
  const selected = values?.[0];

  if (!selected) {
    await interaction.reply({
      content: '⚠️ No field selected.',
      ephemeral: true,
    });
    return;
  }

  // === Handle Edit Stat Select ===
  if (customId.startsWith('editStatSelect:')) {
    try {
      const [, gameId] = customId.split(':');
      const statTemplates = (await getStatTemplates(gameId)) as StatTemplate[];
      const field = statTemplates.find((f) => f.id === selected);

      if (!field) {
        await interaction.reply({
          content: '❌ Could not find that stat field.',
          ephemeral: true,
        });
        return;
      }

      const modal = buildStatTemplateModal({ gameId, field });
      await interaction.showModal(modal);
      return;
    } catch (err) {
      console.error('Error selecting stat field to edit:', err);
      await interaction.reply({
        content: '❌ Failed to show edit modal.',
        ephemeral: true,
      });
      return;
    }
  }

  // === Handle Delete Stat Select (ask for confirmation) ===
  if (customId.startsWith('deleteStatSelect:')) {
    try {
      const [, gameId] = customId.split(':');

      const field = await getStatTemplateById(selected);
      if (!field || field.game_id !== gameId) {
        await interaction.reply({
          content: '❌ Could not find or verify the selected stat field.',
          ephemeral: true,
        });
        return;
      }

      const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirmDeleteStat:${selected}`)
          .setLabel('✅ Confirm Delete')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`finishStatSetup:${gameId}`)
          .setLabel('❌ Cancel')
          .setStyle(ButtonStyle.Secondary),
      );

      await interaction.update({
        content: `🗑️ Are you sure you want to delete stat **${field.label}**?`,
        embeds: [],
        components: [confirmRow],
      });
      return;
    } catch (err) {
      console.error('Error selecting stat field to delete:', err);
      await interaction.reply({
        content: '❌ Failed to prepare delete confirmation.',
        ephemeral: true,
      });
      return;
    }
  }

  // === Fallback: No known customId matched
  await interaction.reply({
    content: '❌ Unknown stat field menu interaction.',
    ephemeral: true,
  });
}
