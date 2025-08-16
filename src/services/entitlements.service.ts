// src/services/entitlements.service.ts
import type { FeatureKey } from '../access/features';

type Entitlement = {
  status: 'active' | 'expired';
  planName?: string | null;
  features: Set<FeatureKey>;
  expiresAt?: Date | null;
};

export async function getEntitlementsFor({
  guildId,
}: {
  guildId: string | null;
}): Promise<Entitlement | null> {
  if (!guildId) return null;

  // const row = await SubscriptionDAO.findActive({ guildId });
  // if (!row) return null;

  const features = new Set<FeatureKey>(['core']);
  // if (row.plan === 'Pro') {
  //   features.add('rpg:characters');
  //   features.add('rpg:game-admin');
  //   features.add('rpg:inventory');
  //   features.add('automation:thread-bump');
  // }

  return {
    status: 'active', // or row.status
    planName: 'DevMock', // or row.plan
    features,
    expiresAt: null, // or row.expiresAt
  };
}
