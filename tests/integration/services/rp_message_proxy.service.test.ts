import { Collection, type Message } from 'discord.js';

import { CharacterDAO } from '../../../src/dao/character.dao';
import { GameDAO } from '../../../src/dao/game.dao';
import { RpProxyMessageDAO } from '../../../src/dao/rp_proxy_message.dao';
import {
  deleteRoleplayProxyMessage,
  editRoleplayProxyMessage,
  fetchProxyMessageContent,
  handleRoleplayProxyMessage,
} from '../../../src/services/rp_message_proxy.service';
import {
  isUserInCharacterForChannel,
  setUserChannelInCharacterMode,
} from '../../../src/services/rp_channel_mode.service';
import { getOrCreatePlayer, setCurrentCharacter } from '../../../src/services/player.service';

function createWebhookMock() {
  return {
    id: 'webhook-1',
    name: 'Spritebot RP Proxy',
    send: jest.fn().mockResolvedValue({ id: 'proxy-1' }),
    editMessage: jest.fn().mockResolvedValue({ id: 'proxy-1' }),
    fetchMessage: jest.fn().mockResolvedValue({ id: 'proxy-1', content: 'Current content' }),
    deleteMessage: jest.fn().mockResolvedValue(undefined),
  };
}

function createParentChannel(webhook = createWebhookMock()) {
  return {
    id: 'parent-1',
    fetchWebhooks: jest.fn().mockResolvedValue(new Collection()),
    createWebhook: jest.fn().mockResolvedValue(webhook),
  };
}

function createThreadChannel() {
  return {
    id: 'thread-1',
    parentId: 'parent-1',
    isThread: () => true,
  };
}

function createThreadMessage({
  client,
  channel = createThreadChannel(),
}: {
  client: unknown;
  channel?: unknown;
}) {
  return {
    author: { id: 'user-1', bot: false },
    channel,
    channelId: 'thread-1',
    client,
    content: 'Testing in a thread',
    delete: jest.fn().mockResolvedValue(undefined),
    embeds: [],
    guild: { id: 'guild-1' },
    guildId: 'guild-1',
    reply: jest.fn().mockResolvedValue(undefined),
    webhookId: null,
    attachments: new Collection(),
  } as unknown as Message;
}

async function createActiveCharacter() {
  const game = await new GameDAO().create({
    name: 'Thread Campaign',
    description: '',
    created_by: 'gm-1',
    guild_id: 'guild-1',
  });

  const character = await new CharacterDAO().create({
    user_id: 'user-1',
    game_id: game.id,
    name: 'Thread Hero',
    avatar_url: 'https://example.test/avatar.png',
    bio: null,
  });

  await getOrCreatePlayer('user-1', 'guild-1');
  await setCurrentCharacter('user-1', 'guild-1', character.id);

  return character;
}

describe('rp_message_proxy.service thread handling', () => {
  test('self-heals stale IC mode when no active character exists', async () => {
    await setUserChannelInCharacterMode({
      guildId: 'guild-1',
      channelId: 'parent-1',
      userId: 'user-1',
      isIc: true,
    });
    const parentChannel = createParentChannel();
    const threadChannel = createThreadChannel();
    const client = {
      channels: {
        fetch: jest.fn(async (channelId: string) =>
          channelId === 'parent-1' ? parentChannel : threadChannel,
        ),
      },
    };
    const message = createThreadMessage({ client, channel: threadChannel });

    await expect(handleRoleplayProxyMessage(message)).resolves.toEqual({
      status: 'failed',
      reason: 'no_active_character',
    });
    expect(message.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('moved you out-of-character') }),
    );
    await expect(isUserInCharacterForChannel('guild-1', 'parent-1', 'user-1')).resolves.toBe(false);
  });

  test('proxies thread messages through the parent channel webhook when IC mode is set on the parent', async () => {
    await createActiveCharacter();
    await setUserChannelInCharacterMode({
      guildId: 'guild-1',
      channelId: 'parent-1',
      userId: 'user-1',
      isIc: true,
    });

    const webhook = createWebhookMock();
    const parentChannel = createParentChannel(webhook);
    const threadChannel = createThreadChannel();
    const client = {
      channels: {
        fetch: jest.fn(async (channelId: string) =>
          channelId === 'parent-1' ? parentChannel : threadChannel,
        ),
      },
    };
    const message = createThreadMessage({ client, channel: threadChannel });

    await expect(handleRoleplayProxyMessage(message)).resolves.toEqual({
      status: 'proxied',
      chunks: 1,
    });

    expect(parentChannel.createWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Spritebot RP Proxy' }),
    );
    expect(webhook.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Testing in a thread',
        threadId: 'thread-1',
        username: 'Thread Hero',
      }),
    );
    expect(message.delete).toHaveBeenCalled();

    await expect(new RpProxyMessageDAO().findByMessageId('proxy-1')).resolves.toEqual(
      expect.objectContaining({
        channel_id: 'thread-1',
        webhook_id: 'webhook-1',
      }),
    );
  });

  test('does not retry an indeterminate webhook send or delete the original message', async () => {
    await createActiveCharacter();
    await setUserChannelInCharacterMode({
      guildId: 'guild-1',
      channelId: 'parent-1',
      userId: 'user-1',
      isIc: true,
    });
    const webhook = createWebhookMock();
    webhook.send.mockRejectedValue(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
    const parentChannel = createParentChannel(webhook);
    const threadChannel = createThreadChannel();
    const client = {
      channels: {
        fetch: jest.fn(async (channelId: string) =>
          channelId === 'parent-1' ? parentChannel : threadChannel,
        ),
      },
    };
    const message = createThreadMessage({ client, channel: threadChannel });

    await expect(handleRoleplayProxyMessage(message)).rejects.toThrow();
    expect(webhook.send).toHaveBeenCalledTimes(1);
    expect(message.delete).not.toHaveBeenCalled();
  });

  test('edits proxied thread messages by resolving the parent webhook and passing threadId', async () => {
    await createActiveCharacter();
    const character = await new CharacterDAO().findByUser('user-1');
    await new RpProxyMessageDAO().create({
      proxyMessageId: 'proxy-1',
      guildId: 'guild-1',
      channelId: 'thread-1',
      userId: 'user-1',
      characterId: character[0].id,
      webhookId: 'webhook-1',
      chunkIndex: 0,
    });

    const webhook = createWebhookMock();
    const webhooks = new Collection<string, typeof webhook>();
    webhooks.set(webhook.id, webhook);
    const parentChannel = createParentChannel(webhook);
    parentChannel.fetchWebhooks.mockResolvedValue(webhooks);
    const threadChannel = createThreadChannel();
    const client = {
      channels: {
        fetch: jest.fn(async (channelId: string) =>
          channelId === 'parent-1' ? parentChannel : threadChannel,
        ),
      },
    };

    await expect(
      editRoleplayProxyMessage({
        client: client as never,
        guildId: 'guild-1',
        userId: 'user-1',
        messageId: 'proxy-1',
        content: 'Edited in thread',
      }),
    ).resolves.toEqual({ status: 'updated' });

    expect(client.channels.fetch).toHaveBeenCalledWith('thread-1');
    expect(client.channels.fetch).toHaveBeenCalledWith('parent-1');
    expect(webhook.editMessage).toHaveBeenCalledWith(
      'proxy-1',
      expect.objectContaining({
        content: 'Edited in thread',
        threadId: 'thread-1',
      }),
    );
  });

  test('fetches current proxied message content through the webhook', async () => {
    await createActiveCharacter();
    const [character] = await new CharacterDAO().findByUser('user-1');
    await new RpProxyMessageDAO().create({
      proxyMessageId: 'proxy-1',
      guildId: 'guild-1',
      channelId: 'thread-1',
      userId: 'user-1',
      characterId: character.id,
      webhookId: 'webhook-1',
      chunkIndex: 0,
    });

    const webhook = createWebhookMock();
    const webhooks = new Collection<string, typeof webhook>();
    webhooks.set(webhook.id, webhook);
    const parentChannel = createParentChannel(webhook);
    parentChannel.fetchWebhooks.mockResolvedValue(webhooks);
    const threadChannel = createThreadChannel();
    const client = {
      channels: {
        fetch: jest.fn(async (channelId: string) =>
          channelId === 'parent-1' ? parentChannel : threadChannel,
        ),
      },
    };

    await expect(
      fetchProxyMessageContent({
        client: client as never,
        guildId: 'guild-1',
        channelId: 'thread-1',
        userId: 'user-1',
        messageId: 'proxy-1',
      }),
    ).resolves.toEqual({ status: 'found', content: 'Current content' });

    expect(webhook.fetchMessage).toHaveBeenCalledWith('proxy-1', { threadId: 'thread-1' });
  });

  test('deletes proxied thread messages by resolving the parent webhook and passing threadId', async () => {
    await createActiveCharacter();
    const [character] = await new CharacterDAO().findByUser('user-1');
    await new RpProxyMessageDAO().create({
      proxyMessageId: 'proxy-1',
      guildId: 'guild-1',
      channelId: 'thread-1',
      userId: 'user-1',
      characterId: character.id,
      webhookId: 'webhook-1',
      chunkIndex: 0,
    });

    const webhook = createWebhookMock();
    const webhooks = new Collection<string, typeof webhook>();
    webhooks.set(webhook.id, webhook);
    const parentChannel = createParentChannel(webhook);
    parentChannel.fetchWebhooks.mockResolvedValue(webhooks);
    const threadChannel = createThreadChannel();
    const client = {
      channels: {
        fetch: jest.fn(async (channelId: string) =>
          channelId === 'parent-1' ? parentChannel : threadChannel,
        ),
      },
    };

    await expect(
      deleteRoleplayProxyMessage({
        client: client as never,
        guildId: 'guild-1',
        channelId: 'thread-1',
        userId: 'user-1',
        messageId: 'proxy-1',
      }),
    ).resolves.toEqual({ status: 'deleted' });

    expect(webhook.deleteMessage).toHaveBeenCalledWith('proxy-1', 'thread-1');
    await expect(new RpProxyMessageDAO().findByMessageId('proxy-1')).resolves.toBeNull();
  });
});
