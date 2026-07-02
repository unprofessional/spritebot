const DISCORD_MESSAGE_LINK =
  /^https?:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(?<guildId>\d+)\/(?<channelId>\d+)\/(?<messageId>\d+)$/;
const SNOWFLAKE = /^\d{15,25}$/;

export interface DiscordMessageReference {
  guildId?: string;
  channelId: string;
  messageId: string;
}

export function parseDiscordMessageReference(
  input: string,
  fallbackChannelId: string,
): DiscordMessageReference | null {
  const trimmed = input.trim().replace(/^<|>$/g, '');
  const linkMatch = trimmed.match(DISCORD_MESSAGE_LINK);

  if (linkMatch?.groups?.channelId && linkMatch.groups.messageId) {
    return {
      guildId: linkMatch.groups.guildId,
      channelId: linkMatch.groups.channelId,
      messageId: linkMatch.groups.messageId,
    };
  }

  if (SNOWFLAKE.test(trimmed)) {
    return {
      channelId: fallbackChannelId,
      messageId: trimmed,
    };
  }

  return null;
}
