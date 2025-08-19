// src/services/entitlements.service.ts

import type { FeatureKey } from '../access/features';
import { featuresForSkus } from './plans';
import { EntitlementsCacheDAO } from '../dao/entitlements_cache.dao';
import { fetchGuildEntitlementsLazy } from './discord_entitlements_api';

const dao = new EntitlementsCacheDAO();

export type EntitlementResult = {
  status: 'active' | 'expired';
  planName?: string | null;
  features: Set<FeatureKey>;
  expiresAt?: Date | null;
};

/**
 * Guild-scoped entitlements resolution with lazy pull + cache.
 */
export async function getEntitlementsFor({
  guildId,
}: {
  guildId: string | null;
}): Promise<EntitlementResult | null> {
  if (!guildId) {
    console.debug('[Entitlements] No guildId provided → returning null');
    return null;
  }

  console.debug(`[Entitlements] Checking entitlements for guild=${guildId}`);

  // 1) Try cache first
  let rows = await dao.findActiveByGuild(guildId);
  console.debug(`[Entitlements] Cache lookup returned ${rows.length} active rows`);

  // 2) If no active cache rows, lazily pull from Discord and cache
  if (!rows.length) {
    const applicationId = process.env.DISCORD_CLIENT_ID!;
    const botToken = process.env.DISCORD_BOT_TOKEN!;

    console.debug(`[Entitlements] Cache miss → fetching entitlements from Discord API...`);
    try {
      const ents = await fetchGuildEntitlementsLazy({ applicationId, botToken, guildId });
      console.debug(`[Entitlements] Discord API returned ${ents.length} entitlements`);

      for (const e of ents) {
        if (e.guild_id !== guildId) {
          console.debug(`[Entitlements] Skipping entitlement ${e.id} (guild mismatch)`);
          continue;
        }
        const now = Date.now();
        const endsAt = e.ends_at ? new Date(e.ends_at) : null;
        const isActive = !endsAt || endsAt.getTime() > now;

        console.debug(
          `[Entitlements] Upserting entitlement id=${e.id} sku=${e.sku_id} active=${isActive}`,
        );

        await dao.upsertFromWebhook({
          entitlementId: e.id,
          guildId: guildId,
          skuId: e.sku_id,
          status: isActive ? 'active' : 'expired',
          startsAt: e.starts_at ?? new Date(0).toISOString(),
          endsAt: e.ends_at ?? null,
          raw: e as any,
        });
      }

      rows = await dao.findActiveByGuild(guildId);
      console.debug(`[Entitlements] Post-upsert cache rows=${rows.length}`);
    } catch (err) {
      console.warn('[Entitlements] ⚠️ Discord entitlements fetch failed:', err);
    }
  }

  // 3) If still nothing, return at least core
  if (!rows.length) {
    console.debug(`[Entitlements] No entitlements found → granting core only`);
    return {
      status: 'active',
      planName: 'Core',
      features: new Set<FeatureKey>(['core']),
      expiresAt: null,
    };
  }

  // Union features for all active SKUs
  const skuIds = rows.map((r) => r.sku_id);
  console.debug(`[Entitlements] Active SKU ids:`, skuIds);

  const features = featuresForSkus(skuIds);
  console.debug(`[Entitlements] Computed features:`, Array.from(features));

  // Compute nearest expiry
  const expiries = rows.map((r) => r.ends_at).filter(Boolean) as Date[];
  const expiresAt = expiries.length
    ? new Date(Math.min(...expiries.map((d) => d.getTime())))
    : null;

  console.debug(
    `[Entitlements] Returning result with features=${Array.from(features)} expiresAt=${expiresAt}`,
  );

  return {
    status: 'active',
    planName: 'Discord Plan', // refine later
    features,
    expiresAt,
  };
}
