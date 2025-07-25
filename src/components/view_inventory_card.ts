import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  APIEmbed,
  APIActionRowComponent,
  APIButtonComponent,
} from 'discord.js';

export const id = 'viewInventoryCard';

export function build(character: {
  id: string;
  name: string;
  inventory: {
    id: string;
    name: string;
    type?: string | null;
    description?: string | null;
    equipped: boolean;
    fields?: Record<string, unknown>;
  }[];
}): {
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIButtonComponent>[];
} {
  const items = character.inventory || [];

  const itemLines = items.map((item) => {
    const equipped = item.equipped ? '✅' : '▫️';
    const typeText = item.type ? `(${item.type})` : '';
    const descText = item.description ? ` — _${item.description}_` : '';
    return `${equipped} **${item.name}** ${typeText}${descText}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`${character.name} — Inventory`)
    .setDescription(itemLines.join('\n') || '_Empty_')
    .setFooter({ text: 'Equipped items marked with ✅' });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`add_inventory_item:${character.id}`)
      .setLabel('➕ Add Item')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`clear_inventory:${character.id}`)
      .setLabel('🗑️ Delete All')
      .setStyle(ButtonStyle.Danger),
  );

  return {
    embeds: [embed.toJSON()],
    components: [row.toJSON()],
  };
}
