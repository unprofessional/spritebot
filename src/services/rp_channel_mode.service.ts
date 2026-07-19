import { RpChannelModeDAO } from '../dao/rp_channel_mode.dao';

const rpChannelModeDAO = new RpChannelModeDAO();

export async function setUserChannelInCharacterMode({
  guildId,
  channelId,
  userId,
  isIc,
}: {
  guildId: string;
  channelId: string;
  userId: string;
  isIc: boolean;
}) {
  return rpChannelModeDAO.setMode({ guildId, channelId, userId, isIc });
}

export async function isUserInCharacterForChannel(
  guildId: string,
  channelId: string,
  userId: string,
): Promise<boolean> {
  return rpChannelModeDAO.isInCharacter(guildId, channelId, userId);
}

export async function isUserInCharacterForChannelScope({
  guildId,
  channelId,
  parentChannelId = null,
  userId,
}: {
  guildId: string;
  channelId: string;
  parentChannelId?: string | null;
  userId: string;
}): Promise<boolean> {
  const channelMode = await rpChannelModeDAO.getMode(guildId, channelId, userId);
  if (channelMode !== null) return channelMode;

  if (parentChannelId && parentChannelId !== channelId) {
    return rpChannelModeDAO.isInCharacter(guildId, parentChannelId, userId);
  }

  return false;
}

export async function clearUserGuildInCharacterModes(
  guildId: string,
  userId: string,
): Promise<number> {
  return rpChannelModeDAO.clearUserGuildModes(guildId, userId);
}
