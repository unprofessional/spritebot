import { FEATURE_LABELS, type FeatureKey } from '../access/features';
import { GiftedGuildsDAO } from '../dao/gifted_guilds.dao';
import { getEntitlementsFor } from './entitlements.service';

const giftedGuildsDAO = new GiftedGuildsDAO();
const allFeatures = Object.freeze(Object.keys(FEATURE_LABELS) as FeatureKey[]);

export type HelpFeaturesResult =
  | { ok: true; features: ReadonlySet<FeatureKey> }
  | { ok: false; reason: 'unavailable' };

/** Resolve the capabilities help should display for a guild. */
export async function getHelpFeatures(guildId: string): Promise<HelpFeaturesResult> {
  try {
    if (await giftedGuildsDAO.isGifted(guildId)) {
      return { ok: true, features: new Set(allFeatures) };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.warn(
      `[Help] Gifted lookup failed guild=${guildId}; continuing to entitlements: ${message}`,
    );
  }

  const entitlement = await getEntitlementsFor({ guildId });
  if (!entitlement || entitlement.status === 'unavailable') {
    return { ok: false, reason: 'unavailable' };
  }

  return { ok: true, features: entitlement.features };
}
