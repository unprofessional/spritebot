import type { APIEmbed, Attachment, Client, Collection, Message, Webhook } from 'discord.js';

import { CharacterDAO } from '../dao/character.dao';
import { PlayerDAO } from '../dao/player.dao';
import { RpProxyMessageDAO } from '../dao/rp_proxy_message.dao';
import { RP_PROXY_TOTAL_CHARACTER_LIMIT, splitRpMessage } from '../utils/rp_message_limits';
import { isUserInCharacterForChannelScope } from './rp_channel_mode.service';

const RP_PROXY_WEBHOOK_NAME = 'Spritebot RP Proxy';
const MESSAGE_TEXT_ATTACHMENT_NAME = 'message.txt';

const characterDAO = new CharacterDAO();
const playerDAO = new PlayerDAO();
const proxyMessageDAO = new RpProxyMessageDAO();

interface ProxyCharacter {
  name?: string | null;
  avatar_url?: string | null;
  rp_display_name?: string | null;
  rp_display_avatar_url?: string | null;
}

export type RpProxyResult =
  | { status: 'ignored'; reason: string }
  | { status: 'proxied'; chunks: number }
  | { status: 'too_long'; length: number }
  | { status: 'failed'; reason: string };

type WebhookCapableChannel = TextBasedChannel & {
  fetchWebhooks(): Promise<Collection<string, Webhook>>;
  createWebhook(options: { name: string; reason?: string }): Promise<Webhook>;
};

type TextBasedChannel = Message['channel'];

interface ProxyWebhookTarget {
  channel: WebhookCapableChannel;
  threadId?: string;
}

function isWebhookCapableChannel(channel: unknown): channel is WebhookCapableChannel {
  return (
    !!channel &&
    typeof channel === 'object' &&
    'fetchWebhooks' in channel &&
    'createWebhook' in channel
  );
}

function getParentChannelId(channel: unknown): string | null {
  if (!channel || typeof channel !== 'object') return null;
  if ('parentId' in channel) {
    const parentId = (channel as { parentId?: unknown }).parentId;
    return typeof parentId === 'string' ? parentId : null;
  }

  return null;
}

function isThreadChannel(channel: unknown): boolean {
  return (
    !!channel &&
    typeof channel === 'object' &&
    'isThread' in channel &&
    typeof (channel as { isThread?: unknown }).isThread === 'function' &&
    (channel as { isThread: () => boolean }).isThread()
  );
}

function getProxyDisplay(character: ProxyCharacter): { username: string; avatarURL?: string } {
  const username = String(character.rp_display_name || character.name || 'Character').slice(0, 80);
  const avatarURL = character.rp_display_avatar_url || character.avatar_url || undefined;

  return { username, avatarURL };
}

function getNonTextAttachmentFiles(message: Message) {
  return message.attachments
    .filter((attachment) => attachment.name !== MESSAGE_TEXT_ATTACHMENT_NAME)
    .map((attachment) => ({
      attachment: attachment.url,
      name: attachment.name ?? undefined,
    }));
}

async function readMessageTextAttachment(attachment: Attachment): Promise<string> {
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${MESSAGE_TEXT_ATTACHMENT_NAME}: ${response.status}`);
  }

  return response.text();
}

async function getMessageContent(message: Message): Promise<string> {
  const inlineContent = message.content?.trim() ?? '';
  const textAttachment = message.attachments.find(
    (attachment) => attachment.name === MESSAGE_TEXT_ATTACHMENT_NAME,
  );

  if (!textAttachment) return inlineContent;

  const attachmentText = (await readMessageTextAttachment(textAttachment)).trim();
  return [inlineContent, attachmentText].filter(Boolean).join('\n\n');
}

async function getOrCreateProxyWebhook(channel: WebhookCapableChannel): Promise<Webhook> {
  const webhooks = await channel.fetchWebhooks();
  const existing = webhooks.find((webhook) => webhook.name === RP_PROXY_WEBHOOK_NAME);
  if (existing) return existing;

  return channel.createWebhook({
    name: RP_PROXY_WEBHOOK_NAME,
    reason: 'Spritebot roleplay proxy messages',
  });
}

async function getExistingProxyWebhook(
  channel: WebhookCapableChannel,
  webhookId: string,
): Promise<Webhook | null> {
  const webhooks = await channel.fetchWebhooks();
  return webhooks.get(webhookId) ?? null;
}

async function fetchWebhookCapableChannel(
  client: Client,
  channelId: string,
): Promise<WebhookCapableChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return isWebhookCapableChannel(channel) ? channel : null;
}

async function resolveProxyWebhookTarget(message: Message): Promise<ProxyWebhookTarget | null> {
  if (isWebhookCapableChannel(message.channel)) {
    return { channel: message.channel };
  }

  if (!isThreadChannel(message.channel)) {
    return null;
  }

  const parentChannelId = getParentChannelId(message.channel);
  if (!parentChannelId) return null;

  const parentChannel = await fetchWebhookCapableChannel(message.client, parentChannelId);
  if (!parentChannel) return null;

  return {
    channel: parentChannel,
    threadId: message.channelId,
  };
}

async function resolveProxyWebhookTargetForChannel(
  client: Client,
  channelId: string,
): Promise<ProxyWebhookTarget | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (isWebhookCapableChannel(channel)) {
    return { channel };
  }

  if (!isThreadChannel(channel)) {
    return null;
  }

  const parentChannelId = getParentChannelId(channel);
  if (!parentChannelId) return null;

  const parentChannel = await fetchWebhookCapableChannel(client, parentChannelId);
  if (!parentChannel) return null;

  return {
    channel: parentChannel,
    threadId: channelId,
  };
}

export type RpProxyMutationResult =
  | { status: 'updated' }
  | { status: 'deleted' }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'invalid_content'; reason: string }
  | { status: 'failed'; reason: string };

export async function editRoleplayProxyMessage({
  client,
  guildId,
  channelId,
  userId,
  messageId,
  content,
}: {
  client: Client;
  guildId: string;
  channelId: string;
  userId: string;
  messageId: string;
  content: string;
}): Promise<RpProxyMutationResult> {
  const trimmed = content.trim();
  if (!trimmed) return { status: 'invalid_content', reason: 'empty' };
  if (trimmed.length > 2000) return { status: 'invalid_content', reason: 'too_long' };

  const record = await proxyMessageDAO.findByMessageId(messageId);
  if (!record || record.guild_id !== guildId || record.channel_id !== channelId) {
    return { status: 'not_found' };
  }
  if (record.user_id !== userId) return { status: 'forbidden' };

  const target = await resolveProxyWebhookTargetForChannel(client, record.channel_id);
  if (!target) return { status: 'failed', reason: 'channel_cannot_webhook' };

  const webhook = await getExistingProxyWebhook(target.channel, record.webhook_id);
  if (!webhook) return { status: 'failed', reason: 'webhook_not_found' };

  await webhook.editMessage(record.proxy_message_id, {
    content: trimmed,
    threadId: target.threadId,
    allowedMentions: { parse: [] },
  });
  await proxyMessageDAO.touch(record.proxy_message_id);

  return { status: 'updated' };
}

export async function deleteRoleplayProxyMessage({
  client,
  guildId,
  channelId,
  userId,
  messageId,
}: {
  client: Client;
  guildId: string;
  channelId: string;
  userId: string;
  messageId: string;
}): Promise<RpProxyMutationResult> {
  const record = await proxyMessageDAO.findByMessageId(messageId);
  if (!record || record.guild_id !== guildId || record.channel_id !== channelId) {
    return { status: 'not_found' };
  }
  if (record.user_id !== userId) return { status: 'forbidden' };

  const target = await resolveProxyWebhookTargetForChannel(client, record.channel_id);
  if (!target) return { status: 'failed', reason: 'channel_cannot_webhook' };

  const webhook = await getExistingProxyWebhook(target.channel, record.webhook_id);
  if (!webhook) return { status: 'failed', reason: 'webhook_not_found' };

  await webhook.deleteMessage(record.proxy_message_id, target.threadId);
  await proxyMessageDAO.delete(record.proxy_message_id);

  return { status: 'deleted' };
}

export async function handleRoleplayProxyMessage(message: Message): Promise<RpProxyResult> {
  if (message.author.bot || message.webhookId) return { status: 'ignored', reason: 'bot' };
  if (!message.guildId || !message.guild) return { status: 'ignored', reason: 'not_guild' };
  const target = await resolveProxyWebhookTarget(message);
  if (!target) {
    return { status: 'ignored', reason: 'channel_cannot_webhook' };
  }

  const isIc = await isUserInCharacterForChannelScope({
    guildId: message.guildId,
    channelId: message.channelId,
    parentChannelId: getParentChannelId(message.channel),
    userId: message.author.id,
  });
  if (!isIc) return { status: 'ignored', reason: 'user_ooc_in_channel' };

  const activeCharacterId = await playerDAO.getCurrentCharacter(message.author.id, message.guildId);
  if (!activeCharacterId) {
    await message.reply({
      content:
        'You are in-character in this channel, but you do not have an active character selected. Use `/switch-character` first.',
      allowedMentions: { parse: [] },
    });
    return { status: 'failed', reason: 'no_active_character' };
  }

  const character = await characterDAO.findById(activeCharacterId);
  if (!character) {
    await message.reply({
      content:
        'You are in-character in this channel, but I could not find your active character. Use `/switch-character` to select one again.',
      allowedMentions: { parse: [] },
    });
    return { status: 'failed', reason: 'character_not_found' };
  }

  const content = await getMessageContent(message);
  const files = getNonTextAttachmentFiles(message);
  if (!content && files.length === 0 && message.embeds.length === 0) {
    return { status: 'ignored', reason: 'empty_message' };
  }

  if (content.length > RP_PROXY_TOTAL_CHARACTER_LIMIT) {
    await message.reply({
      content: `This RP post is ${content.length} characters, but the IC proxy limit is ${RP_PROXY_TOTAL_CHARACTER_LIMIT}. I left your original message in place so you can edit and repost it.`,
      allowedMentions: { parse: [] },
    });
    return { status: 'too_long', length: content.length };
  }

  const chunks = splitRpMessage(content);
  const webhook = await getOrCreateProxyWebhook(target.channel);
  const display = getProxyDisplay(character);
  const embeds = message.embeds.map((embed) => embed.toJSON() as APIEmbed);
  const sends = chunks.length ? chunks : [''];

  for (let index = 0; index < sends.length; index++) {
    const sent = await webhook.send({
      content: sends[index],
      username: display.username,
      avatarURL: display.avatarURL,
      threadId: target.threadId,
      files: index === 0 ? files : [],
      embeds: index === 0 ? embeds : [],
      allowedMentions: { parse: [] },
    });
    await proxyMessageDAO.create({
      proxyMessageId: sent.id,
      guildId: message.guildId,
      channelId: message.channelId,
      userId: message.author.id,
      characterId: activeCharacterId,
      webhookId: webhook.id,
      chunkIndex: index,
    });
  }

  await message.delete();
  return { status: 'proxied', chunks: sends.length };
}
