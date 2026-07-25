import { GameDAO } from '../../../src/dao/game.dao';
import { handle as handleEntitySelector } from '../../../src/components/game_entity_selector';
import { build as buildEntityCard } from '../../../src/components/view_game_entity_card';
import type { DiscordInteractionResponder } from '../../../src/discord/interaction_responder';
import { createGameEntity, updateGameEntityMeta } from '../../../src/services/game_entity.service';

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
});
