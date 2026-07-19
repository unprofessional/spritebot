# SPRITEbot — Integrations Entitlement Support

## Context

SPRITE-Integrations (TaleSpire bridge) needs to gate its commands and webhook endpoints behind the same Premium subscription that @SPRITE uses. Because the two bots are separate Discord applications, SPRITE-Integrations reads entitlement state directly from SPRITEbot's database (`entitlements_cache` + `gifted_guilds` tables).

**Full implementation plan:** [`spritebot-integrations/plans/entitlement-reconciliation.md`](https://github.com/unprofessional/spritebot-integrations/blob/develop/plans/entitlement-reconciliation.md)

This document covers only the changes needed on the **spritebot** side.

---

## Changes Required

### 1. New feature key: `integrations:talespire`

**File: `src/access/features.ts`**

Add the feature key to the `FeatureKey` union type:

```typescript
export type FeatureKey =
  | 'core'
  | 'rpg:characters'
  | 'rpg:inventory'
  | 'rpg:game-admin'
  | 'automation:thread-bump'
  | 'pro:transcription'
  | 'integrations:talespire'; // NEW
```

Add a label:

```typescript
'integrations:talespire': 'TaleSpire Integration',
```

No entry needed in `CommandPolicy` — spritebot itself has no TaleSpire commands. This key exists so that `featuresForSkus` can resolve it for SPRITE-Integrations' cross-database reads, and for future use in `/subscribe` or help output that lists what's included in Premium.

### 2. Add feature to Premium SKU bundle

**File: `src/services/plans.ts`**

```typescript
export const PLAN_FEATURES: Record<string, FeatureKey[]> = {
  '1405308360818954322': [
    'core',
    'rpg:characters',
    'rpg:inventory',
    'rpg:game-admin',
    'automation:thread-bump',
    'integrations:talespire', // NEW — bundled in Premium
  ],
};
```

**Decision (resolved 2026-07-19):** TaleSpire is bundled into the existing Premium SKU, not a separate tier. Better for niche marketing — "you already have Premium? TaleSpire integration is included."

### 3. Postgres read-only role for SPRITE-Integrations

SPRITE-Integrations connects to spritebot's database with a read-only role to check entitlement state. This avoids any inter-service API or entitlement duplication.

```sql
-- Run on spritebot's database (postgres-18, shinralabs)
CREATE ROLE sprite_integrations_reader WITH LOGIN PASSWORD '<generate>';
GRANT CONNECT ON DATABASE spritebot TO sprite_integrations_reader;
GRANT USAGE ON SCHEMA public TO sprite_integrations_reader;
GRANT SELECT ON entitlements_cache, gifted_guilds TO sprite_integrations_reader;
```

Store the connection string in Infisical under `spritebot` project as `SPRITE_INTEGRATIONS_SPRITEBOT_DATABASE_URL`.

---

## What This Enables

SPRITE-Integrations runs queries like:

```sql
SELECT 1 FROM entitlements_cache
WHERE guild_id = $1 AND status = 'active' AND (ends_at IS NULL OR ends_at > NOW())
LIMIT 1;

SELECT 1 FROM gifted_guilds
WHERE guild_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
LIMIT 1;
```

If either returns a row, the guild has Premium and TaleSpire commands/webhooks are allowed. Otherwise, commands return an ephemeral upgrade message and webhooks return 403.

---

## Edge Cases

- **Entitlement cache miss:** If spritebot hasn't cached a new subscription yet (e.g., spritebot was down when the user subscribed), SPRITE-Integrations will see no rows and deny access. The gap closes when spritebot processes the `EntitlementCreate` event or a user triggers a lazy pull via any @SPRITE command.
- **Subscription lapse:** Hard cutoff. Discord sets `ends_at` on cancel-forward; `EntitlementDelete` fires on chargebacks/revocations. Both are already handled by spritebot's existing event handlers.
- **Gifted guilds:** Automatically covered — SPRITE-Integrations checks `gifted_guilds` alongside `entitlements_cache`.
