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

  // 🔓 0) Full dev bypass
  if (process.env.NODE_ENV !== 'production') {
    return { ok: true, planName: 'DevBypass' };
  }

  // 1) Must be in a guild for a guild-scoped subscription model
  if (!guildId) return { ok: false, reason: 'NO_GUILD' };

  // 2) Owner/global bypass
  if (OWNER_IDS.has(userId)) return { ok: true, planName: 'Owner' };

  // 3) Admin role bypass (optional)
  if (ADMIN_BYPASS && member?.permissions?.has?.('Administrator')) {
    return { ok: true, planName: 'Admin Bypass' };
  }

  // 4) Resolve entitlements (guild-level only)
  const ent = await getEntitlementsFor({ guildId });

  if (!ent) return { ok: false, reason: 'NO_SUBSCRIPTION' };
  if (ent.status === 'expired') return { ok: false, reason: 'EXPIRED' };
  if (!ent.features.has(feature)) return { ok: false, reason: 'NOT_INCLUDED' };

  return { ok: true, planName: ent.planName ?? null };
}
