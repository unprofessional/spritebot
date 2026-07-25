import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { discordCustomId } from '../../utils/discord_custom_id';

import { belongsToUser } from '../../services/character.service';
import { getItemForCharacter } from '../../services/inventory.service';
import type { InteractionDispatchPolicy } from '../../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../../discord/interaction_responder';
import { presentPreparedModal } from '../../discord/prepared_modal';

export const interactionPolicy = {
  mode: { kind: 'component-update' },
  acknowledgement: 'auto-defer',
} satisfies InteractionDispatchPolicy;

export async function handle(
  interaction: StringSelectMenuInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const [, characterId, rawPage] = interaction.customId.split(':');
  const itemId = interaction.values?.[0];

  if (!itemId) {
    await responder.respond({
      content: '⚠️ No inventory item selected.',
      ephemeral: true,
    });
    return;
  }

  const ownsCharacter = await belongsToUser(characterId, interaction.user.id);
  if (!ownsCharacter) {
    await responder.respond({
      content: '❌ You can only manage inventory for your own characters.',
      ephemeral: true,
    });
    return;
  }

  const item = await getItemForCharacter(characterId, itemId);
  if (!item) {
    await responder.respond({
      content: '❌ Inventory item not found.',
      ephemeral: true,
    });
    return;
  }

  const page = parseInt(rawPage, 10) || 0;
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        discordCustomId(`invEq:${characterId}:${itemId}:${page}:${item.equipped ? 'off' : 'on'}`),
      )
      .setLabel(item.equipped ? 'Unequip Item' : 'Equip Item')
      .setStyle(item.equipped ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(discordCustomId(`invEdit:${characterId}:${itemId}:${page}`))
      .setLabel('View/Edit Item')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(discordCustomId(`invDel:${characterId}:${itemId}:${page}`))
      .setLabel('Delete Item')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(discordCustomId(`cancel_inventory_item_action:${characterId}:${page}`))
      .setLabel('↩️ Go Back')
      .setStyle(ButtonStyle.Secondary),
  );

  await responder.respond({
    content: `Selected **${item.name}**.`,
    components: [actionRow],
  });
}

export async function buildEditModal(
  responder: DiscordInteractionResponder,
  userId: string,
  characterId: string,
  itemId: string,
  page: number,
): Promise<void> {
  const item = await getItemForCharacter(characterId, itemId);
  if (!item) {
    await responder.respond({
      content: '❌ Inventory item not found.',
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(discordCustomId(`editInventoryModal:${characterId}:${itemId}:${page}`))
    .setTitle(truncate(`Edit ${item.name}`))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(discordCustomId('name'))
          .setLabel('Item Name')
          .setStyle(TextInputStyle.Short)
          .setValue(item.name)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(discordCustomId('type'))
          .setLabel('Item Type / Category (optional)')
          .setStyle(TextInputStyle.Short)
          .setValue(item.type ?? '')
          .setRequired(false),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(discordCustomId('quantity'))
          .setLabel('Quantity')
          .setStyle(TextInputStyle.Short)
          .setValue(String(item.quantity))
          .setRequired(false),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(discordCustomId('description'))
          .setLabel('Description (optional)')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(item.description ?? '')
          .setRequired(false),
      ),
    );

  await presentPreparedModal({ modal, responder, userId });
}

function truncate(value: string, maxLength = 45): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength - 1) + '…';
}
