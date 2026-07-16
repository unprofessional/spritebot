import { CharacterDAO } from '../../../src/dao/character.dao';
import { GameDAO } from '../../../src/dao/game.dao';
import { createItem } from '../../../src/services/inventory.service';
import { handle } from '../../../src/handlers/select_menu_handlers/inventory_item_select';
import { interactionPolicy } from '../../../src/handlers/select_menu_handlers/inventory_item_select';
import { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';

describe('inventory_item_select', () => {
  const characterDAO = new CharacterDAO();
  const gameDAO = new GameDAO();

  async function createCharacter() {
    const game = await gameDAO.create({
      name: 'Treasure Road',
      description: 'Item-heavy adventure',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });

    return characterDAO.create({
      user_id: 'player-1',
      game_id: game.id,
      name: 'Pockets Deepwell',
      bio: null,
      avatar_url: null,
    });
  }

  test('builds selected item actions with Discord-safe custom ids', async () => {
    const character = await createCharacter();
    const item = await createItem(character.id, {
      name: 'Iron Sword',
      quantity: 1,
    });
    const update = jest.fn().mockResolvedValue(undefined);
    const interaction = {
      customId: `editInventoryItemSelect:${character.id}:0`,
      values: [item.id],
      user: { id: 'player-1' },
      replied: false,
      deferred: false,
      update,
      reply: jest.fn(),
      deferUpdate: jest.fn(),
      editReply: jest.fn(),
      followUp: jest.fn(),
    } as any;
    const responder = new DiscordInteractionResponder(interaction, interactionPolicy.mode);

    await handle(interaction, responder);

    const payload = update.mock.calls[0][0];
    const components = payload.components[0].toJSON().components as Array<{ custom_id: string }>;
    const customIds = components.map((component) => component.custom_id);

    expect(customIds).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^invEq:/),
        expect.stringMatching(/^invEdit:/),
        expect.stringMatching(/^invDel:/),
        expect.stringMatching(/^cancel_inventory_item_action:/),
      ]),
    );
    expect(customIds.every((customId) => customId.length <= 100)).toBe(true);
  });

  test('routes a missing selection to a private follow-up after component deferral', async () => {
    const interaction = {
      customId: 'editInventoryItemSelect:character-1:0',
      values: [],
      user: { id: 'player-1' },
      replied: false,
      deferred: false,
      update: jest.fn(),
      reply: jest.fn(),
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn(),
      followUp: jest.fn().mockResolvedValue(undefined),
    } as any;
    const responder = new DiscordInteractionResponder(interaction, interactionPolicy.mode);

    await responder.acknowledge();
    await handle(interaction, responder);

    expect(interaction.followUp).toHaveBeenCalledWith({
      content: '⚠️ No inventory item selected.',
      ephemeral: true,
    });
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});
