import type {
  APIEmbed,
  Attachment,
  Collection,
  Message,
  TextBasedChannel,
  Webhook,
} from 'discord.js';

import { CharacterDAO } from '../dao/character.dao';
import { PlayerDAO } from '../dao/player.dao';
import { RP_PROXY_TOTAL_CHARACTER_LIMIT, splitRpMessage } from '../utils/rp_message_limits';
import { isChannelInCharacter } from './rp_channel_mode.service';

const RP_PROXY_WEBHOOK_NAME = 'Spritebot RP Proxy';
const MESSAGE_TEXT_ATTACHMENT_NAME = 'message.txt';

const characterDAO = new CharacterDAO();
const playerDAO = new PlayerDAO();

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

function isWebhookCapableChannel(channel: TextBasedChannel): channel is WebhookCapableChannel {
  return 'fetchWebhooks' in channel && 'createWebhook' in channel;
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

export async function handleRoleplayProxyMessage(message: Message): Promise<RpProxyResult> {
  if (message.author.bot || message.webhookId) return { status: 'ignored', reason: 'bot' };
  if (!message.guildId || !message.guild) return { status: 'ignored', reason: 'not_guild' };
  if (!isWebhookCapableChannel(message.channel)) {
    return { status: 'ignored', reason: 'channel_cannot_webhook' };
  }

  const isIc = await isChannelInCharacter(message.guildId, message.channelId);
  if (!isIc) return { status: 'ignored', reason: 'ooc_channel' };

  const activeCharacterId = await playerDAO.getCurrentCharacter(message.author.id, message.guildId);
  if (!activeCharacterId) {
    await message.reply({
      content:
        'This channel is in-character, but you do not have an active character selected. Use `/switch-character` first.',
      allowedMentions: { parse: [] },
    });
    return { status: 'failed', reason: 'no_active_character' };
  }

  const character = await characterDAO.findById(activeCharacterId);
  if (!character) {
    await message.reply({
      content:
        'This channel is in-character, but I could not find your active character. Use `/switch-character` to select one again.',
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
  const webhook = await getOrCreateProxyWebhook(message.channel);
  const display = getProxyDisplay(character);
  const embeds = message.embeds.map((embed) => embed.toJSON() as APIEmbed);
  const sends = chunks.length ? chunks : [''];

  for (let index = 0; index < sends.length; index++) {
    await webhook.send({
      content: sends[index],
      username: display.username,
      avatarURL: display.avatarURL,
      files: index === 0 ? files : [],
      embeds: index === 0 ? embeds : [],
      allowedMentions: { parse: [] },
    });
  }

  await message.delete();
  return { status: 'proxied', chunks: sends.length };
}
