// src/services/plans.ts
import type { FeatureKey } from '../access/features';

/**
 * Map your Discord SKU IDs to feature bundles.
 * Fill these with your real SKU IDs from your Discord app.
 */
export const PLAN_FEATURES: Record<string /* sku_id */, FeatureKey[]> = {
  // Premium intentionally excludes pro:transcription. The future Pro SKU will
  // include this bundle plus transcription as a separate paid tier.
  '1405308360818954322': [
    'core',
    'rpg:characters',
    'rpg:inventory',
    'rpg:game-admin',
    'automation:thread-bump',
    'integrations:talespire',
  ],
};

export function featuresForSkus(skuIds: string[]): Set<FeatureKey> {
  const out = new Set<FeatureKey>(['core']);
  for (const id of skuIds) {
    const arr = PLAN_FEATURES[id];
    if (!arr) continue;
    for (const f of arr) out.add(f);
  }
  return out;
}
