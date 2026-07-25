import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import type { HydratedGameEntity, HydratedGameEntityInventoryItem } from '../types/game_entity';
import { formatCharacterStatValue } from '../utils/character_stat_display';

export function build(entity: HydratedGameEntity, canManage: boolean) {
  const embed = new EmbedBuilder()
    .setTitle(entity.name)
    .setAuthor({ name: entity.kind === 'npc' ? 'NPC' : 'Creature' })
    .setDescription(entity.bio ? `_${entity.bio}_` : null)
    .setFooter({ text: `Visibility: ${entity.visibility} • ${labelForKind(entity.kind)}` });

  if (entity.avatar_url) embed.setImage(entity.avatar_url);

  for (const stat of entity.stats.filter((entry) => entry.field_type === 'paragraph')) {
    if (stat.value.trim()) {
      embed.addFields({
        name: stat.label,
        value: truncate(stat.value, 1024),
        inline: false,
      });
    }
  }

  const compactStats = entity.stats.filter((entry) => entry.field_type !== 'paragraph');
  for (const stat of compactStats.slice(0, 12)) {
    embed.addFields({
      name: stat.label,
      value: formatCharacterStatValue(stat) ?? '—',
      inline: true,
    });
  }

  for (const field of entity.customFields.slice(0, 6)) {
    embed.addFields({ name: field.name, value: truncate(field.value, 1024), inline: true });
  }

  const equipped = entity.inventory.filter((item) => item.equipped);
  if (equipped.length) {
    embed.addFields({
      name: 'Equipped Items',
      value: equipped.map(formatInventoryLine).join('\n'),
      inline: false,
    });
  }

  if (!canManage) return { embeds: [embed], components: [] };

  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`editGameEntity:${entity.id}`)
      .setLabel('✏️ Edit')
      .setStyle(ButtonStyle.Primary),
    ...visibilityButtons(entity),
    new ButtonBuilder()
      .setCustomId(`viewGameEntityInventory:${entity.id}`)
      .setLabel('🎒 Inventory')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`deleteGameEntity:${entity.id}`)
      .setLabel('🗑️ Delete')
      .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [actions] };
}

export function buildInventory(entity: HydratedGameEntity) {
  const embed = new EmbedBuilder()
    .setTitle(`${entity.name} — Inventory`)
    .setDescription(entity.inventory.map(formatInventoryLine).join('\n') || '_Empty_')
    .setFooter({ text: `${labelForKind(entity.kind)} inventory` });
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`addGameEntityInventory:${entity.id}`)
        .setLabel('➕ Add Item')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`backToGameEntity:${entity.id}`)
        .setLabel('↩️ Back')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  if (entity.inventory.length) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`manageGameEntityInventory:${entity.id}`)
          .setPlaceholder('Choose an inventory item')
          .addOptions(
            entity.inventory.slice(0, 25).map((item) => ({
              label: truncate(item.name, 100),
              value: item.id,
              description: truncate(
                `${item.equipped ? 'Equipped' : 'Unequipped'} • Quantity ${item.quantity}`,
                100,
              ),
            })),
          ),
      ),
    );
  }

  return { embeds: [embed], components: rows };
}

export function buildInventoryItemActions(entityId: string, item: HydratedGameEntityInventoryItem) {
  const embed = new EmbedBuilder()
    .setTitle(item.name)
    .setDescription(item.description || '_No description_')
    .addFields(
      { name: 'Quantity', value: String(item.quantity), inline: true },
      { name: 'Equipped', value: item.equipped ? 'Yes' : 'No', inline: true },
      ...(item.type ? [{ name: 'Type', value: item.type, inline: true }] : []),
      ...item.fields.map((field) => ({
        name: field.name,
        value: truncate(field.value, 1024),
        inline: true,
      })),
    );
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `equipGameEntityInventory:${entityId}:${item.id}:${item.equipped ? 'off' : 'on'}`,
      )
      .setLabel(item.equipped ? '▫️ Unequip' : '✅ Equip')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`deleteGameEntityInventory:${entityId}:${item.id}`)
      .setLabel('🗑️ Delete Item')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`viewGameEntityInventory:${entityId}`)
      .setLabel('↩️ Back')
      .setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [actions] };
}

function formatInventoryLine(item: HydratedGameEntityInventoryItem): string {
  const quantity = item.quantity > 1 ? ` ×${item.quantity}` : '';
  return `${item.equipped ? '✅' : '▫️'} **${item.name}**${quantity}`;
}

function visibilityButtons(entity: HydratedGameEntity): ButtonBuilder[] {
  const choices = (
    [
      ['public', '🌐 Publish'],
      ['link-only', '🔗 Link-only'],
      ['private', '🔒 Make Private'],
    ] as const
  ).filter(([visibility]) => visibility !== entity.visibility);

  return choices.map(([visibility, label]) =>
    new ButtonBuilder()
      .setCustomId(`setGameEntityVisibility:${entity.id}:${visibility}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Secondary),
  );
}

function labelForKind(kind: string): string {
  return kind === 'npc' ? 'NPC' : 'Creature';
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
