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
