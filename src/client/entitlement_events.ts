import { Client, Entitlement, Events } from 'discord.js';

import { EntitlementsCacheDAO } from '../dao/entitlements_cache.dao';
import { isDrainInProgressError, isDraining, trackOperation } from '../runtime/lifecycle';

const dao = new EntitlementsCacheDAO();

function timestampToDate(timestamp: number | null): Date {
  return timestamp == null ? new Date(0) : new Date(timestamp);
}

function rawEntitlement(entitlement: Entitlement): Record<string, unknown> {
  return {
    id: entitlement.id,
    skuId: entitlement.skuId,
    guildId: entitlement.guildId,
    userId: entitlement.userId,
    startsTimestamp: entitlement.startsTimestamp,
    endsTimestamp: entitlement.endsTimestamp,
    deleted: entitlement.deleted,
  };
}

async function upsertEntitlement(
  entitlement: Entitlement,
  status: 'active' | 'expired',
): Promise<void> {
  if (!entitlement.guildId) {
    console.debug(
      `[entitlement_events] Skipping entitlement id=${entitlement.id} sku=${entitlement.skuId} without guildId`,
    );
    return;
  }

  console.debug(
    `[entitlement_events] Upserting entitlement id=${entitlement.id} guild=${entitlement.guildId} ` +
      `sku=${entitlement.skuId} status=${status}`,
  );

  await dao.upsertFromWebhook({
    entitlementId: entitlement.id,
    guildId: entitlement.guildId,
    skuId: entitlement.skuId,
    status,
    startsAt: timestampToDate(entitlement.startsTimestamp),
    endsAt: entitlement.endsTimestamp == null ? null : new Date(entitlement.endsTimestamp),
    raw: rawEntitlement(entitlement),
  });
}

export function initializeEntitlementEvents(client: Client): void {
  client.on(Events.EntitlementCreate, (entitlement) => {
    void (async () => {
      if (isDraining()) return;
      try {
        await trackOperation('entitlement:create', () => upsertEntitlement(entitlement, 'active'));
      } catch (err) {
        if (isDrainInProgressError(err)) return;
        console.error('[entitlement_events] Failed to process entitlement create:', err);
      }
    })();
  });

  client.on(Events.EntitlementUpdate, (_oldEntitlement, newEntitlement) => {
    void (async () => {
      if (isDraining()) return;
      try {
        await trackOperation('entitlement:update', () =>
          upsertEntitlement(newEntitlement, 'active'),
        );
      } catch (err) {
        if (isDrainInProgressError(err)) return;
        console.error('[entitlement_events] Failed to process entitlement update:', err);
      }
    })();
  });

  client.on(Events.EntitlementDelete, (entitlement) => {
    void (async () => {
      if (isDraining()) return;
      try {
        await trackOperation('entitlement:delete', () => upsertEntitlement(entitlement, 'expired'));
      } catch (err) {
        if (isDrainInProgressError(err)) return;
        console.error('[entitlement_events] Failed to process entitlement delete:', err);
      }
    })();
  });
}
