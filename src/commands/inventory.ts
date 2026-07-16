// src/commands/inventory.ts

import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { build as buildInventoryCard } from '../components/view_inventory_card';
import { getCharacterWithInventory } from '../services/inventory.service';
import { getCurrentCharacter } from '../services/player.service';
import { validateGameAccess } from '../utils/validate_game_access';
import type {
  InteractionCommandContext,
  InteractionDispatchPolicy,
} from '../discord/interaction_dispatch';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription("View your character's inventory and manage items."),

  interactionPolicy: {
    mode: { kind: 'reply', visibility: 'ephemeral' },
    acknowledgement: 'auto-defer',
  } satisfies InteractionDispatchPolicy,

  async execute(
    interaction: ChatInputCommandInteraction<CacheType>,
    { responder }: InteractionCommandContext,
  ) {
    const userId = interaction.user.id;
    const guildId = interaction.guild?.id;

    if (!guildId) {
      return await responder.respond({
        content: '⚠️ This command must be used in a server.',
        ephemeral: true,
      });
    }

    let response: Record<string, unknown>;
    try {
      response = await buildInventoryResponse(userId, guildId);
    } catch (err) {
      console.error('Error in /inventory:', err);
      response = {
        content: '❌ Failed to retrieve inventory.',
        ephemeral: true,
      };
    }

    return await responder.respond(response);
  },
};

async function buildInventoryResponse(
  userId: string,
  guildId: string,
): Promise<Record<string, unknown>> {
  const characterId = await getCurrentCharacter(userId, guildId);
  if (!characterId) {
    return {
      content: '⚠️ No active character selected. Use `/switch-character` first.',
      ephemeral: true,
    };
  }

  const character = await getCharacterWithInventory(characterId);
  if (!character || typeof character.game_id !== 'string') {
    return {
      content: '⚠️ Could not load character or inventory.',
      ephemeral: true,
    };
  }

  const { valid, warning } = await validateGameAccess({
    gameId: character.game_id,
    userId,
  });
  if (!valid) {
    return {
      content: warning || '⚠️ You no longer have access to this game.',
      ephemeral: true,
    };
  }

  const { embeds, components } = buildInventoryCard(character);
  return {
    content: warning || undefined,
    embeds,
    components,
    ephemeral: true,
  };
}
