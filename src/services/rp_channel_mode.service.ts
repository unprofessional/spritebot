import { RpChannelModeDAO } from '../dao/rp_channel_mode.dao';

const rpChannelModeDAO = new RpChannelModeDAO();

export async function setChannelInCharacterMode({
  guildId,
  channelId,
  isIc,
  updatedBy,
}: {
  guildId: string;
  channelId: string;
  isIc: boolean;
  updatedBy: string;
}) {
  return rpChannelModeDAO.setMode({ guildId, channelId, isIc, updatedBy });
}

export async function isChannelInCharacter(guildId: string, channelId: string): Promise<boolean> {
  return rpChannelModeDAO.isInCharacter(guildId, channelId);
}
