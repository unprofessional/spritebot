import type { GuildMember } from 'discord.js';

import { SupportVerificationDAO, type SupportPlayerMatch } from '../dao/support_verification.dao';
import { supportGuildId, supportPlayerRoleId, supportSubscriberRoleId } from '../config/env_config';

const dao = new SupportVerificationDAO();

export interface SupportVerificationEligibility {
  subscriberGuildIds: string[];
  playerGuilds: SupportPlayerMatch[];
}

export interface SupportVerificationResult extends SupportVerificationEligibility {
  assignedRoleIds: string[];
  missingRoleIds: string[];
}

export async function getSupportVerificationEligibility(
  userId: string,
): Promise<SupportVerificationEligibility> {
  const [subscriberGuilds, playerGuilds] = await Promise.all([
    dao.findSubscriberGuilds(userId),
    dao.findPlayerGuilds(userId),
  ]);

  return {
    subscriberGuildIds: subscriberGuilds.map((row) => row.guild_id),
    playerGuilds,
  };
}

export function hasSupportVerificationMatch(result: SupportVerificationEligibility): boolean {
  return result.subscriberGuildIds.length > 0 || result.playerGuilds.length > 0;
}

function supportVerificationConfig() {
  // Read env at call time so tests or process managers that set env after module import are honored.
  return {
    guildId: process.env.SUPPORT_GUILD_ID ?? supportGuildId,
    subscriberRoleId: process.env.SUBSCRIBER_ROLE_ID ?? supportSubscriberRoleId,
    playerRoleId: process.env.PLAYER_ROLE_ID ?? supportPlayerRoleId,
  };
}

export async function verifySupportMember(member: GuildMember): Promise<SupportVerificationResult> {
  const { guildId, subscriberRoleId, playerRoleId } = supportVerificationConfig();

  if (member.guild.id !== guildId) {
    return {
      subscriberGuildIds: [],
      playerGuilds: [],
      assignedRoleIds: [],
      missingRoleIds: [],
    };
  }

  const eligibility = await getSupportVerificationEligibility(member.user.id);
  const roleIdsToAdd = new Set<string>();
  const missingRoleIds: string[] = [];

  if (eligibility.subscriberGuildIds.length) {
    if (subscriberRoleId) roleIdsToAdd.add(subscriberRoleId);
    else missingRoleIds.push('subscriber');
  }

  if (eligibility.playerGuilds.length) {
    if (playerRoleId) roleIdsToAdd.add(playerRoleId);
    else missingRoleIds.push('player');
  }

  const assignedRoleIds = [...roleIdsToAdd].filter((roleId) => !member.roles.cache.has(roleId));
  if (assignedRoleIds.length) {
    await member.roles.add(assignedRoleIds, 'SPRITEbot support server verification');
  }

  return {
    ...eligibility,
    assignedRoleIds,
    missingRoleIds,
  };
}
