import { GameDAO } from '../../../src/dao/game.dao';
import { handle as handleEntitySelector } from '../../../src/components/game_entity_selector';
import { build as buildEntityFieldSelector } from '../../../src/components/game_entity_field_selector';
import { build as buildEntityCard } from '../../../src/components/view_game_entity_card';
import { handle as handleRestoreEntity } from '../../../src/components/restore_game_entity_selector';
import type { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import { handle as handleEntityButtons } from '../../../src/handlers/button_handlers/game_entity_buttons';
import { handle as handleEntityModal } from '../../../src/handlers/modal_handlers/game_entity_modals';
import {
  createGameEntity,
  getGameEntity,
  updateGameEntityMeta,
} from '../../../src/services/game_entity.service';
import { getOrCreatePlayer, setCurrentGame } from '../../../src/services/player.service';

const viewEntityCommand = require('../../../src/commands/view-entity') as {
  execute(
    interaction: unknown,
    context: { responder: DiscordInteractionResponder },
  ): Promise<unknown>;
};

describe('game entity Discord UI', () => {
  const gameDAO = new GameDAO();

  async function setupEntity(visibility: 'private' | 'public' | 'link-only') {
    const game = await gameDAO.create({
      name: 'Entity UI Game',
      description: '',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });
    const entity = await createGameEntity({
      requesterId: 'gm-1',
      gameId: game.id,
      kind: 'creature',
      name: 'Mooncalf',
      visibility,
    });
    return { game, entity };
  }

  test('labels entity kind and only renders management controls for the game creator', async () => {
    const { entity } = await setupEntity('public');

    const publicCard = buildEntityCard(entity, false);
    const managerCard = buildEntityCard(entity, true);

    expect(publicCard.embeds[0].toJSON()).toEqual(
      expect.objectContaining({
        title: 'Mooncalf',
        author: { name: 'Creature' },
      }),
    );
    expect(publicCard.components).toEqual([]);
    expect(
      managerCard.components[0].components.map((component) => component.data.custom_id),
    ).toEqual([
      `editGameEntity:${entity.id}`,
      `toggleGameEntityVisibility:${entity.id}`,
      `viewGameEntityInventory:${entity.id}`,
      `deleteGameEntity:${entity.id}`,
    ]);
  });

  test('blocks private entities from a crafted public selector interaction', async () => {
    const { entity } = await setupEntity('private');
    const respond = jest.fn().mockResolvedValue(undefined);

    await handleEntitySelector(
      {
        customId: 'selectGameEntity',
        values: [entity.id],
        user: { id: 'player-1' },
      } as never,
      { respond } as unknown as DiscordInteractionResponder,
    );

    expect(respond).toHaveBeenCalledWith({
      content: '❌ That entity is not publicly discoverable.',
      embeds: [],
      components: [],
    });
  });

  test('renders public entities read-only and private entities with controls for the manager', async () => {
    const { entity } = await setupEntity('private');
    const respond = jest.fn().mockResolvedValue(undefined);

    await handleEntitySelector(
      {
        customId: 'selectGameEntity',
        values: [entity.id],
        user: { id: 'gm-1' },
      } as never,
      { respond } as unknown as DiscordInteractionResponder,
    );
    expect(respond.mock.calls[0][0].components).toHaveLength(1);

    await updateGameEntityMeta(entity.id, 'gm-1', { visibility: 'public' });
    respond.mockClear();
    await handleEntitySelector(
      {
        customId: 'selectGameEntity',
        values: [entity.id],
        user: { id: 'player-1' },
      } as never,
      { respond } as unknown as DiscordInteractionResponder,
    );
    expect(respond.mock.calls[0][0].components).toEqual([]);
  });

  test('blocks a crafted edit interaction before rendering a private entity', async () => {
    const { entity } = await setupEntity('private');
    const respond = jest.fn().mockResolvedValue(undefined);
    const showModal = jest.fn().mockResolvedValue(undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await handleEntityButtons(
      {
        customId: `editGameEntity:${entity.id}`,
        user: { id: 'player-1' },
      } as never,
      { respond, showModal } as unknown as DiscordInteractionResponder,
    );

    expect(respond).toHaveBeenCalledWith({
      content: '❌ You cannot manage that NPC or creature.',
      ephemeral: true,
    });
    expect(respond.mock.calls.flat().join(' ')).not.toContain('Mooncalf');
    expect(showModal).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('creates and edits custom fields through the entity editor', async () => {
    const { entity } = await setupEntity('private');
    const respond = jest.fn().mockResolvedValue(undefined);

    await handleEntityModal(
      {
        customId: `editGameEntityCustomModal:${entity.id}`,
        user: { id: 'gm-1' },
        fields: {
          getTextInputValue: (name: string) =>
            ({ name: 'Faction', value: 'Moon Court' })[name as 'name' | 'value'],
        },
      } as never,
      { respond } as unknown as DiscordInteractionResponder,
    );

    let hydrated = await getGameEntity(entity.id);
    expect(hydrated?.customFields).toEqual([
      expect.objectContaining({ name: 'Faction', value: 'Moon Court' }),
    ]);
    const customField = hydrated!.customFields[0];
    const selector = buildEntityFieldSelector(hydrated!).toJSON();
    expect(selector.components[0].options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Add Custom Field' }),
        expect.objectContaining({
          label: '[CUSTOM] Faction',
          value: `custom|${customField.id}|paragraph`,
        }),
      ]),
    );

    respond.mockClear();
    await handleEntityModal(
      {
        customId: `editGameEntityModal:${entity.id}:custom:${customField.id}`,
        user: { id: 'gm-1' },
        fields: { getTextInputValue: () => 'Sun Court' },
      } as never,
      { respond } as unknown as DiscordInteractionResponder,
    );
    hydrated = await getGameEntity(entity.id);
    expect(hydrated?.customFields).toEqual([
      expect.objectContaining({ name: 'Faction', value: 'Sun Court' }),
    ]);
  });

  test('rejects malformed direct entity IDs without querying PostgreSQL', async () => {
    const { game } = await setupEntity('public');
    await getOrCreatePlayer('player-1', 'guild-1');
    await setCurrentGame('player-1', 'guild-1', game.id);
    const respond = jest.fn().mockResolvedValue(undefined);

    await viewEntityCommand.execute(
      {
        guildId: 'guild-1',
        user: { id: 'player-1' },
        options: { getString: () => 'test' },
      },
      { responder: { respond } as unknown as DiscordInteractionResponder },
    );

    expect(respond).toHaveBeenCalledWith({
      content: '⚠️ Entity ID must be a valid UUID.',
      ephemeral: true,
    });
  });

  test('returns a specific validation message for fractional inventory quantities', async () => {
    const { entity } = await setupEntity('private');
    const respond = jest.fn().mockResolvedValue(undefined);

    await handleEntityModal(
      {
        customId: `addGameEntityInventoryModal:${entity.id}`,
        user: { id: 'gm-1' },
        fields: {
          getTextInputValue: (name: string) =>
            ({
              name: 'Potion',
              type: '',
              description: '',
              quantity: '1.5',
            })[name as 'name' | 'type' | 'description' | 'quantity'],
        },
      } as never,
      { respond } as unknown as DiscordInteractionResponder,
    );

    expect(respond).toHaveBeenCalledWith({
      content: '⚠️ Quantity must be a positive whole number.',
      ephemeral: true,
    });
  });

  test('requires confirmation to delete and restores the entity as private', async () => {
    const { entity } = await setupEntity('public');
    const respond = jest.fn().mockResolvedValue(undefined);

    await handleEntityButtons(
      {
        customId: `deleteGameEntity:${entity.id}`,
        user: { id: 'gm-1' },
      } as never,
      { respond } as unknown as DiscordInteractionResponder,
    );
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(`Delete **${entity.name}**?`),
        components: expect.any(Array),
      }),
    );
    expect(await getGameEntity(entity.id)).not.toBeNull();

    respond.mockClear();
    await handleEntityButtons(
      {
        customId: `confirmDeleteGameEntity:${entity.id}`,
        user: { id: 'gm-1' },
      } as never,
      { respond } as unknown as DiscordInteractionResponder,
    );
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Entity deleted') }),
    );
    expect(await getGameEntity(entity.id)).toBeNull();

    respond.mockClear();
    await handleRestoreEntity(
      {
        customId: 'restoreGameEntityDropdown',
        values: [entity.id],
        user: { id: 'gm-1' },
      } as never,
      { respond } as unknown as DiscordInteractionResponder,
    );
    expect(respond).toHaveBeenCalledWith({
      content: `✅ Restored **${entity.name}** as a private ${entity.kind}.`,
      components: [],
    });
    await expect(getGameEntity(entity.id)).resolves.toMatchObject({ visibility: 'private' });
  });

  test('denies crafted delete and restore interactions from a non-manager', async () => {
    const { entity } = await setupEntity('private');
    const respond = jest.fn().mockResolvedValue(undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await handleEntityButtons(
      {
        customId: `deleteGameEntity:${entity.id}`,
        user: { id: 'player-1' },
      } as never,
      { respond } as unknown as DiscordInteractionResponder,
    );
    expect(respond).toHaveBeenCalledWith({
      content: '❌ You cannot manage that NPC or creature.',
      ephemeral: true,
    });

    await handleEntityButtons(
      {
        customId: `confirmDeleteGameEntity:${entity.id}`,
        user: { id: 'gm-1' },
      } as never,
      { respond } as unknown as DiscordInteractionResponder,
    );
    respond.mockClear();
    await handleRestoreEntity(
      {
        customId: 'restoreGameEntityDropdown',
        values: [entity.id],
        user: { id: 'player-1' },
      } as never,
      { respond } as unknown as DiscordInteractionResponder,
    );
    expect(respond).toHaveBeenCalledWith({
      content: '⚠️ That entity can no longer be restored.',
      components: [],
    });
    expect(await getGameEntity(entity.id)).toBeNull();
    errorSpy.mockRestore();
  });
});
