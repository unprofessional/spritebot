import { CharacterDAO } from '../../../src/dao/character.dao';
import { GameDAO } from '../../../src/dao/game.dao';
import { RpProxyMessageDAO } from '../../../src/dao/rp_proxy_message.dao';

describe('RpProxyMessageDAO', () => {
  const gameDAO = new GameDAO();
  const characterDAO = new CharacterDAO();
  const rpProxyMessageDAO = new RpProxyMessageDAO();

  async function createCharacter() {
    const game = await gameDAO.create({
      name: 'Message Ownership Campaign',
      description: '',
      created_by: 'gm-1',
      guild_id: 'guild-1',
    });

    return characterDAO.create({
      user_id: 'user-1',
      game_id: game.id,
      name: 'Ownership Hero',
      avatar_url: null,
      bio: null,
    });
  }

  test('creates, updates, finds, touches, and deletes proxy ownership rows', async () => {
    const character = await createCharacter();

    const created = await rpProxyMessageDAO.create({
      proxyMessageId: 'proxy-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1',
      characterId: character.id,
      webhookId: 'webhook-1',
      chunkIndex: 0,
    });

    expect(created).toEqual(
      expect.objectContaining({
        proxy_message_id: 'proxy-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        user_id: 'user-1',
        character_id: character.id,
        webhook_id: 'webhook-1',
        chunk_index: 0,
      }),
    );

    await rpProxyMessageDAO.touch('proxy-1');
    await expect(rpProxyMessageDAO.findByMessageId('proxy-1')).resolves.toEqual(
      expect.objectContaining({
        user_id: 'user-1',
      }),
    );

    await rpProxyMessageDAO.delete('proxy-1');
    await expect(rpProxyMessageDAO.findByMessageId('proxy-1')).resolves.toBeNull();
  });
});
