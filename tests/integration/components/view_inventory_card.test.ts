import { build } from '../../../src/components/view_inventory_card';

function item(index: number) {
  return {
    id: `item-${index}`,
    name: `Item ${index}`,
    type: index % 2 === 0 ? 'Gear' : null,
    description: `Description ${index}`,
    quantity: index,
    equipped: index === 2,
    fields: {},
  };
}

describe('view_inventory_card', () => {
  test('renders inventory in pages with quantity labels and pagination controls', () => {
    const view = build(
      {
        id: 'character-1',
        name: 'Pockets Deepwell',
        inventory: Array.from({ length: 7 }, (_, index) => item(index + 1)),
      },
      0,
    );

    expect(view.embeds[0].description).toContain('**Item 1**');
    expect(view.embeds[0].description).toContain('**Item 2** x2');
    expect(view.embeds[0].description).not.toContain('**Item 7**');
    expect(view.embeds[0].footer?.text).toContain('Page 1 of 2');
    expect(view.components).toHaveLength(3);
    expect(JSON.stringify(view.components[0])).toContain('add_inventory_item:character-1:0');
    expect(JSON.stringify(view.components[0])).toContain('clear_inventory:character-1:0');
    expect(JSON.stringify(view.components[1])).toContain('editInventoryItemSelect:character-1:0');
    expect(JSON.stringify(view.components[1])).toContain('Item 1');
    expect(JSON.stringify(view.components[1])).not.toContain('Item 7');
  });

  test('renders later inventory pages from the same character view', () => {
    const view = build(
      {
        id: 'character-1',
        name: 'Pockets Deepwell',
        inventory: Array.from({ length: 7 }, (_, index) => item(index + 1)),
      },
      1,
    );

    expect(view.embeds[0].description).toContain('**Item 7** x7');
    expect(view.embeds[0].description).not.toContain('**Item 1**');
    expect(view.embeds[0].footer?.text).toContain('Page 2 of 2');
  });
});
