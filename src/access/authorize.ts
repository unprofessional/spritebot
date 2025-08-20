// src/access/authorize.ts
import type { GuildMember } from 'discord.js';
import { getEntitlementsFor } from '../services/entitlements.service';
import { GiftedGuildsDAO } from '../dao/gifted_guilds.dao';
import type { FeatureKey } from './features';

export type AuthResult =
  | { ok: true; planName: string | null }
  | { ok: false; reason: 'NO_GUILD' | 'NO_SUBSCRIPTION' | 'EXPIRED' | 'NOT_INCLUDED' | 'UNKNOWN' };

const OWNER_IDS = new Set<string>([process.env.OWNER_DISCORD_ID ?? '']); // optional
const ADMIN_BYPASS = process.env.ADMIN_BYPASS === 'true'; // default off in prod
const giftedDAO = new GiftedGuildsDAO();

export async function authorizeInteraction(
  opts: {
    feature: FeatureKey;
    guildId?: string | null;
    userId: string;
  },
  member?: GuildMember | null,
): Promise<AuthResult> {
  const { feature, guildId, userId } = opts;

  console.debug(
    `[authorizeInteraction] user=${userId} guild=${guildId ?? 'null'} feature=${feature}`,
  );

  // 🔒 Removed DevBypass

  // 1) Must be in a guild for a guild-scoped subscription model
  if (!guildId) {
    console.debug(`[authorizeInteraction] ❌ No guildId provided`);
    return { ok: false, reason: 'NO_GUILD' };
  }

  // 2) Owner/global bypass
  if (OWNER_IDS.has(userId)) {
    console.debug(`[authorizeInteraction] ✅ Owner bypass for user=${userId}`);
    return { ok: true, planName: 'Owner' };
  }

  // 3) Admin role bypass (optional, env-gated)
  if (ADMIN_BYPASS && member?.permissions?.has?.('Administrator')) {
    console.debug(`[authorizeInteraction] ✅ Admin bypass for user=${userId}`);
    return { ok: true, planName: 'Admin Bypass' };
  }

  // 4) Resolve entitlements (guild-level only)
  console.debug(`[authorizeInteraction] Fetching entitlements for guild=${guildId}`);
  const ent = await getEntitlementsFor({ guildId });

  let entitlementOutcome: AuthResult | null = null;

  if (!ent) {
    console.debug(`[authorizeInteraction] ❌ No entitlements found for guild=${guildId}`);
    entitlementOutcome = { ok: false, reason: 'NO_SUBSCRIPTION' };
  } else {
    console.debug(
      `[authorizeInteraction] Entitlement resolved plan=${ent.planName} status=${ent.status} features=[${[
        ...ent.features,
      ].join(',')}]`,
    );

    if (ent.status === 'expired') {
      console.debug(`[authorizeInteraction] ❌ Entitlement expired`);
      entitlementOutcome = { ok: false, reason: 'EXPIRED' };
    } else if (!ent.features.has(feature)) {
      console.debug(
        `[authorizeInteraction] ❌ Feature "${feature}" not included in plan=${ent.planName}`,
      );
      entitlementOutcome = { ok: false, reason: 'NOT_INCLUDED' };
    } else {
      console.debug(
        `[authorizeInteraction] ✅ Access granted for feature=${feature} under plan=${ent.planName}`,
      );
      return { ok: true, planName: ent.planName ?? null };
    }
  }

  // 5) Gifted guild fallback (grants all features)
  console.debug(`[authorizeInteraction] Checking gifted fallback for guild=${guildId}`);
  const gifted = await giftedDAO.isGifted(guildId);
  if (gifted) {
    console.debug(`[authorizeInteraction] ✅ Gifted access granted for guild=${guildId}`);
    return { ok: true, planName: 'Gifted' };
  }

  // 6) Final deny
  console.debug(`[authorizeInteraction] ❌ Access denied (no paid entitlement and not gifted)`);
  return entitlementOutcome ?? { ok: false, reason: 'UNKNOWN' };
}
