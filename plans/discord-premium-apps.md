# SPRITEbot Discord Premium Apps Integration

> **Status:** Planning
> **Replaces:** `plans/stripe-subscriptions.md` (Stripe-only approach)
> **Reason for change:** Discord's Monetization Requirements policy (Oct 2024)
> requires that paid Discord app features be available through Discord's
> Premium Apps system at price parity. Going Discord-native first simplifies
> implementation and eliminates payment infrastructure overhead.

---

## Overview

Use Discord's built-in Premium Apps monetization to sell guild-level
subscriptions. Discord handles payments, tax collection, refunds,
chargebacks, and PCI compliance. SPRITEbot's existing entitlement
framework (`entitlements.service.ts`, `authorize.ts`, `guards.ts`,
`plans.ts`) is already wired for this — it just needs SKU IDs populated.

### Why Discord Premium Apps (Not Stripe-Only)

- **Policy compliance:** Discord requires price parity if selling
  elsewhere; going native-first avoids any risk
- **Zero payment infra:** No webhook endpoint, no HTTP server, no
  Stripe account, no nginx config, no PCI concerns
- **Tax handling:** Discord collects and remits all sales tax/VAT/GST
- **Refund/chargeback handling:** Discord manages disputes
- **Existing code:** Entitlement framework is already built and waiting
  for SKU IDs

### Fee Structure (Growth Tier)

Discord's Growth Tier (first $1M revenue):

- **Platform fee:** 15%
- **Payment processing:** ~6% (varies by payment method/region)
- **Total effective:** ~21%

Standard Tier (after $1M): 30% platform fee + processing.

### Pricing Structure

| Plan                | Price    | After Fees (~21%) | Net Monthly |
| ------------------- | -------- | ----------------- | ----------- |
| **Premium Monthly** | $4.00/mo | ~$3.16            | $3.16       |

> Note: Discord currently supports monthly subscriptions. Annual/quarterly
> billing may be added later when Discord supports those SKU types.
> When they do, we can add discounted annual plans.

All plans are **per server (guild)**, not per user.

---

## What's Already Built

| Component                     | File                                       | Status                                            |
| ----------------------------- | ------------------------------------------ | ------------------------------------------------- |
| Feature keys + CommandPolicy  | `src/access/features.ts`                   | ✅ Complete (including `pro:transcription`)       |
| Component policy              | `src/access/components_policy.ts`          | ✅ Complete                                       |
| Authorization pipeline        | `src/access/authorize.ts`                  | ✅ Complete (checks entitlements → gifted → deny) |
| Command + component guards    | `src/access/guards.ts`                     | ✅ Complete                                       |
| Entitlements service          | `src/services/entitlements.service.ts`     | ✅ Complete (cache + lazy Discord API pull)       |
| Discord entitlements API      | `src/services/discord_entitlements_api.ts` | ✅ Complete                                       |
| Entitlements cache DAO        | `src/dao/entitlements_cache.dao.ts`        | ✅ Complete                                       |
| Plan → feature mapping        | `src/services/plans.ts`                    | ⚠️ Stubbed (needs real SKU IDs)                   |
| Gifted guilds (manual grants) | gifted_guilds table + DAO                  | ✅ Complete                                       |
| Entitlement event listeners   | `src/index.ts` or `src/client/`            | ❌ Not wired                                      |

---

## Implementation

### D0 — mads: Discord Developer Portal Setup

- [ ] **Enable monetization** in the Discord Developer Portal for SPRITEbot
- [ ] **Complete team verification** (if not already done — Discord requires
      identity verification for monetized apps)
- [ ] **Create SKU:** "SPRITEbot Premium" — guild subscription, $4.00/mo
  - Note the SKU ID
- [ ] **Set up Store page** with description, icon, and feature list
- [ ] **Requirements check:**
  - App must have a privacy policy URL set
  - App must have a terms of service URL set
  - These already exist at `unprofessional.github.io/spriteweb/legal/`

### D1 — Populate SKU Mapping

Update `src/services/plans.ts` with real SKU ID:

```typescript
export const PLAN_FEATURES: Record<string, FeatureKey[]> = {
  SKU_ID_HERE: [
    'core',
    'rpg:characters',
    'rpg:inventory',
    'rpg:game-admin',
    'automation:thread-bump',
  ],
};
```

This is a one-line change once the SKU ID is known.

### D2 — Wire Entitlement Events

Add Discord gateway event listeners for real-time entitlement updates:

```typescript
// In client setup
client.on(Events.EntitlementCreate, async (entitlement) => {
  // Upsert to entitlements_cache
});

client.on(Events.EntitlementUpdate, async (entitlement) => {
  // Update cache (renewal, cancellation, etc.)
});

client.on(Events.EntitlementDelete, async (entitlement) => {
  // Remove from cache
});
```

The existing `entitlements.service.ts` already has a lazy pull mechanism
that fetches from the Discord API on cache miss. These events add
real-time cache invalidation so there's no delay when a user subscribes.

### D3 — Add `/subscribe` Command

Simple command with subcommands:

- `/subscribe` — shows current subscription status and a premium
  upsell button if not subscribed
- Uses `interaction.sendPremiumRequired()` or a button linking to the
  SKU's Store page for upgrade flow

Discord handles the entire checkout UI natively in the Discord client.

### D4 — Update Spriteweb Pricing

Update `spriteweb/src/pages/pricing.astro`:

- Change $3/mo → $4/mo
- Add note that purchases are handled through Discord
- Eventually add Pro tier card when transcription ships

### D5 — End-to-End Testing

- Test in a non-entitled server: gated commands should be denied
- Purchase subscription through Discord
- Verify entitlement appears and gated commands work
- Cancel subscription
- Verify access is revoked after period ends

---

## Pro Tier (Future)

When transcription ships, add a second SKU:

- "SPRITEbot Pro" — guild subscription, $8.00/mo (or TBD)
- Maps to all Premium features + `pro:transcription`
- Separate SKU ID in `PLAN_FEATURES`

The entitlement framework already supports multiple SKUs mapping to
different feature sets. No architectural changes needed.

---

## Stripe as Future Add-On

The Stripe integration plan (`plans/stripe-subscriptions.md`) is preserved
but deprioritized. If/when it makes sense to offer direct billing:

- Add Stripe as a parallel entitlement source in `authorize.ts`
- Must maintain price parity with Discord per their policy
- Main benefit: lower fees (2.9% + 30¢ vs ~21%)
- Only worth the ops overhead at meaningful subscriber volume

---

## Implementation Order

| Phase  | What                                                          | Owner        | Depends On              |
| ------ | ------------------------------------------------------------- | ------------ | ----------------------- |
| **D0** | Developer Portal: enable monetization, create SKU, store page | mads         | Privacy/ToS URLs (done) |
| **D1** | Populate `plans.ts` with SKU ID                               | Codex        | D0                      |
| **D2** | Wire entitlement gateway events                               | Codex        | Nothing                 |
| **D3** | `/subscribe` command                                          | Codex        | D1                      |
| **D4** | Update spriteweb pricing page                                 | Codex        | D0 (price confirmed)    |
| **D5** | End-to-end testing                                            | mads + Moldy | All above               |

D1 and D3 are tiny. D2 is small but important. Total estimated effort:
one focused Codex session for D1-D3, maybe an hour of mads's time for D0.
This is dramatically simpler than the Stripe path.
