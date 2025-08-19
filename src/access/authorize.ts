// src/access/authorize.ts
import type { GuildMember } from 'discord.js';
import { getEntitlementsFor } from '../services/entitlements.service';
import type { FeatureKey } from './features';

export type AuthResult =
  | { ok: true; planName: string | null }
  | { ok: false; reason: 'NO_GUILD' | 'NO_SUBSCRIPTION' | 'EXPIRED' | 'NOT_INCLUDED' | 'UNKNOWN' };

const OWNER_IDS = new Set<string>([process.env.OWNER_DISCORD_ID ?? '']); // optional
const ADMIN_BYPASS = true; // flip off in prod if you want

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

  // 🔓 0) Full dev bypass
  if (process.env.NODE_ENV !== 'production') {
    console.debug(`[authorizeInteraction] Dev bypass active`);
    return { ok: true, planName: 'DevBypass' };
  }

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

  // 3) Admin role bypass (optional)
  if (ADMIN_BYPASS && member?.permissions?.has?.('Administrator')) {
    console.debug(`[authorizeInteraction] ✅ Admin bypass for user=${userId}`);
    return { ok: true, planName: 'Admin Bypass' };
  }

  // 4) Resolve entitlements (guild-level only)
  console.debug(`[authorizeInteraction] Fetching entitlements for guild=${guildId}`);
  const ent = await getEntitlementsFor({ guildId });

  if (!ent) {
    console.debug(`[authorizeInteraction] ❌ No entitlements found for guild=${guildId}`);
    return { ok: false, reason: 'NO_SUBSCRIPTION' };
  }

  console.debug(
    `[authorizeInteraction] Entitlement resolved plan=${ent.planName} status=${ent.status} features=[${[
      ...ent.features,
    ].join(',')}]`,
  );

  if (ent.status === 'expired') {
    console.debug(`[authorizeInteraction] ❌ Entitlement expired`);
    return { ok: false, reason: 'EXPIRED' };
  }
  if (!ent.features.has(feature)) {
    console.debug(
      `[authorizeInteraction] ❌ Feature "${feature}" not included in plan=${ent.planName}`,
    );
    return { ok: false, reason: 'NOT_INCLUDED' };
  }

  console.debug(
    `[authorizeInteraction] ✅ Access granted for feature=${feature} under plan=${ent.planName}`,
  );
  return { ok: true, planName: ent.planName ?? null };
}
