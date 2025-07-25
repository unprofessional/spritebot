// src/commands/inventory.ts

import {
  ActionRowBuilder,
  CacheType,
  ChatInputCommandInteraction,
  MessageActionRowComponentBuilder,
  SlashCommandBuilder,
} from 'discord.js';

import { build as buildInventoryCard } from '../components/view_inventory_card';
import { getCharacterWithInventory } from '../services/inventory.service';
import { getCurrentCharacter } from '../services/player.service';
import { validateGameAccess } from '../utils/validate_game_access';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription("View your character's inventory and manage items."),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    const userId = interaction.user.id;
    const guildId = interaction.guild?.id;

    if (!guildId) {
      return await interaction.reply({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    try {
      const characterId = await getCurrentCharacter(userId, guildId);
      if (!characterId) {
        return await interaction.reply({
          content: '⚠️ No active character selected. Use `/switch-character` first.',
          ephemeral: true,
        });
      }

      const character = await getCharacterWithInventory(characterId);

      if (!character || typeof (character as any).game_id !== 'string') {
        return await interaction.reply({
          content: '⚠️ Could not load character or inventory.',
          ephemeral: true,
        });
      }

      const gameId = (character as any).game_id as string;

      const { valid, warning } = await validateGameAccess({
        gameId,
        userId,
      });

      if (!valid) {
        return await interaction.reply({
          content: warning || '⚠️ You no longer have access to this game.',
          ephemeral: true,
        });
      }

      const { embeds, components } = buildInventoryCard(character);

      return await interaction.reply({
        content: warning || undefined,
        embeds,
        components,
        ephemeral: true,
      });
    } catch (err) {
      console.error('Error in /inventory:', err);
      return await interaction.reply({
        content: '❌ Failed to retrieve inventory.',
        ephemeral: true,
      });
    }
  },
};
