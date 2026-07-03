import {
  ActionRowBuilder,
  APIActionRowComponent,
  APIButtonComponent,
  APIEmbed,
  APIStringSelectComponent,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';

export const id = 'viewInventoryCard';
export const inventoryPageId = 'inventoryPage';

const pageSize = 6;
const maxDescriptionLength = 140;

export function buildViewInventoryButton(characterId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`view_inventory:${characterId}`)
    .setLabel('🎒 Inventory')
    .setStyle(ButtonStyle.Secondary);
}

interface InventoryCharacter {
  id: string;
  name: string;
  inventory: {
    id: string;
    name: string;
    type?: string | null;
    description?: string | null;
    quantity: number;
    equipped: boolean;
    fields?: Record<string, unknown>;
  }[];
}

export function build(
  character: InventoryCharacter,
  page = 0,
): {
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIButtonComponent | APIStringSelectComponent>[];
} {
  const items = character.inventory || [];
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const pageItems = items.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const itemLines = pageItems.map((item) => {
    const equipped = item.equipped ? '✅' : '▫️';
    const typeText = item.type ? `(${item.type})` : '';
    const quantityText = item.quantity > 1 ? ` x${item.quantity}` : '';
    const descText = item.description
      ? ` — _${truncate(item.description, maxDescriptionLength)}_`
      : '';
    return `${equipped} **${item.name}**${quantityText} ${typeText}${descText}`.trim();
  });

  const embed = new EmbedBuilder()
    .setTitle(`${character.name} — Inventory`)
    .setDescription(itemLines.join('\n') || '_Empty_')
    .setFooter({
      text:
        items.length > 0
          ? `Page ${safePage + 1} of ${totalPages} • Equipped items marked with ✅`
          : 'Equipped items marked with ✅',
    });

  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`add_inventory_item:${character.id}:${safePage}`)
      .setLabel('➕ Add Item')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`clear_inventory:${character.id}:${safePage}`)
      .setLabel('🗑️ Delete All')
      .setStyle(ButtonStyle.Danger),
  );

  const rows: APIActionRowComponent<APIButtonComponent | APIStringSelectComponent>[] = [
    controls.toJSON(),
  ];

  if (pageItems.length > 0) {
    rows.push(buildEditSelectRow(character.id, safePage, pageItems).toJSON());
  }

  if (totalPages > 1) {
    rows.push(buildPaginationRow(character.id, safePage, totalPages).toJSON());
  }

  return {
    embeds: [embed.toJSON()],
    components: rows,
  };
}

function buildEditSelectRow(
  characterId: string,
  page: number,
  items: InventoryCharacter['inventory'],
): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`editInventoryItemSelect:${characterId}:${page}`)
    .setPlaceholder('Edit an inventory item')
    .addOptions(
      items.map((item) => ({
        label: truncate(item.name, 100),
        value: item.id,
        description: truncate(
          [item.quantity > 1 ? `x${item.quantity}` : null, item.type, item.description]
            .filter(Boolean)
            .join(' • ') || 'Inventory item',
          100,
        ),
      })),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function buildPaginationRow(
  characterId: string,
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${inventoryPageId}:prev:${characterId}:${page}`)
      .setLabel('⬅️ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`${inventoryPageId}:next:${characterId}:${page}`)
      .setLabel('➡️ Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength - 1) + '…';
}
