# SPRITEbot Stripe Subscription Integration — Implementation Plan

> **Status:** Superseded by `discord-premium-apps.md`
> **Target:** SPRITEbot (TypeScript/Node, discord.js 14, Docker on shinralabs)
> **Decision:** Stripe-only billing (no Discord App Subscriptions). Full control over payments, refunds, and disputes.

---

## Overview

Add Stripe-powered guild-level subscriptions to SPRITEbot. Server admins purchase a subscription tied to their Discord guild. SPRITEbot's existing entitlement/access framework (`features.ts`, `authorize.ts`, `guards.ts`) already gates commands by feature key — this plan wires Stripe as the payment source that grants those features.

### Why Stripe, Not Discord Payments

- **Lower fees:** Stripe takes 2.9% + $0.30 vs Discord's 15-30% platform fee
- **Full refund/dispute control:** We handle chargebacks directly, submit evidence, set policy
- **No platform dependency:** Discord can't change terms or fees under us
- **Audience fit:** TTRPG Discord users will handle an external checkout page without friction
- **Already have infra:** Postgres on shinralabs, existing entitlement tables, existing guard pipeline

### Pricing Structure

| Plan                  | Price         | Billing        | Effective Monthly |
| --------------------- | ------------- | -------------- | ----------------- |
| **Premium Monthly**   | $3.00/mo      | Monthly        | $3.00             |
| **Premium Quarterly** | $7.99/quarter | Every 3 months | ~$2.66            |
| **Premium Annual**    | $27.99/year   | Yearly         | ~$2.33            |

All plans are **per server (guild)**, not per user. One subscription unlocks premium features for the entire server.

### Revenue Math (Stripe fees)

| Plan            | Gross  | Stripe Fee   | Net Per Cycle | Net Monthly |
| --------------- | ------ | ------------ | ------------- | ----------- |
| Monthly $3.00   | $3.00  | $0.39 (13%)  | $2.61         | $2.61       |
| Quarterly $7.99 | $7.99  | $0.53 (6.6%) | $7.46         | $2.49       |
| Annual $27.99   | $27.99 | $1.11 (4.0%) | $26.88        | $2.24       |

Longer plans are better margin because Stripe's flat $0.30 per transaction amortizes over more months.

---

## What's Already Built

The access control framework is fully wired. Stripe integration plugs into it, not around it.

| Component            | File                                   | What It Does                                                       |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| Feature keys         | `src/access/features.ts`               | Defines `FeatureKey` union type and `CommandPolicy` mapping        |
| Authorization        | `src/access/authorize.ts`              | Checks entitlements → gifted fallback → deny. Returns `AuthResult` |
| Guards               | `src/access/guards.ts`                 | Slash command + component interaction gates                        |
| Entitlements service | `src/services/entitlements.service.ts` | Resolves guild features from `entitlements_cache`                  |
| Plans                | `src/services/plans.ts`                | Maps SKU IDs → feature bundles (currently empty, Discord-oriented) |
| Gifted guilds        | `gifted_guilds` table + DAO            | Manual grant for comp'd servers                                    |
| Entitlements cache   | `entitlements_cache` table + DAO       | Discord entitlement mirror (will be adapted)                       |

### Key Integration Point

`authorize.ts` step 4 calls `getEntitlementsFor({ guildId })` which checks `entitlements_cache`. The Stripe integration adds a **parallel check** against a new `stripe_subscriptions` table. If either source grants the feature, access is approved. This means Discord entitlements and Stripe subscriptions can coexist if you ever want to add Discord payments later.

---

## Implementation

### Step 0 — mads Setup (Manual, No Code)

These are things only mads can do. Complete before any code work begins.

- [ ] **Create Stripe account** at <https://dashboard.stripe.com/register>
  - Use a real business email (not a throwaway)
  - Business type: Individual/Sole proprietor is fine to start
  - Will need bank account or debit card for payouts
- [ ] **Create Products + Prices in Stripe Dashboard:**
  - Product: "SPRITEbot Premium"
  - Price 1: $3.00 USD, recurring monthly
  - Price 2: $7.99 USD, recurring every 3 months
  - Price 3: $27.99 USD, recurring yearly
  - Note the Price IDs (`price_xxx`) — these go into the bot's config
- [ ] **Get API keys from Stripe Dashboard → Developers → API Keys:**
  - `STRIPE_SECRET_KEY` (starts with `sk_test_` for testing, `sk_live_` for prod)
  - `STRIPE_PUBLISHABLE_KEY` (starts with `pk_test_` / `pk_live_`)
- [ ] **Set up webhook endpoint in Stripe Dashboard → Developers → Webhooks:**
  - URL: `https://<your-domain>/api/stripe/webhook` (will need a public endpoint — see Deployment section)
  - Events to listen for:
    - `checkout.session.completed`
    - `customer.subscription.updated`
    - `customer.subscription.deleted`
    - `invoice.payment_succeeded`
    - `invoice.payment_failed`
  - Note the `STRIPE_WEBHOOK_SECRET` (starts with `whsec_`)
- [ ] **Store secrets in Infisical** (`spritebot` project):
  - `STRIPE_SECRET_KEY`
  - `STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_PRICE_MONTHLY` (the Price ID for $3/mo)
  - `STRIPE_PRICE_QUARTERLY` (the Price ID for $7.99/quarter)
  - `STRIPE_PRICE_ANNUAL` (the Price ID for $27.99/year)
- [ ] **Decide on a domain for the checkout portal.** Options:
  - Subdomain: `subscribe.comfyops.net` or `sprite.comfyops.net`
  - Standalone: register something like `spritebot.gg` (optional, not required)
  - Minimal path: just use `comfyops.net/sprite` if the API is already there
  - The checkout page can also be a simple static HTML page hosted anywhere — it just redirects to Stripe Checkout

### Step 1 — Database Schema

New migration file: `src/db/tables/007_stripe_subscriptions.sql`

```sql
-- === STRIPE SUBSCRIPTIONS (GUILD-SCOPED) ===

CREATE TABLE stripe_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id          TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_price_id   TEXT NOT NULL,
  plan_name         TEXT NOT NULL DEFAULT 'Premium',
  status            TEXT NOT NULL
                    CHECK (status IN ('active', 'past_due', 'canceled', 'unpaid', 'trialing', 'incomplete')),
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  discord_user_id   TEXT NOT NULL,          -- who purchased (for support/audit)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_stripe_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_stripe_subscriptions_updated_at
BEFORE UPDATE ON stripe_subscriptions
FOR EACH ROW
EXECUTE FUNCTION update_stripe_subscriptions_updated_at();

-- Fast lookup: does this guild have an active sub?
CREATE INDEX idx_stripe_subs_guild_status
  ON stripe_subscriptions (guild_id, status)
  WHERE status = 'active';

-- Lookup by Stripe subscription ID (webhook resolution)
CREATE INDEX idx_stripe_subs_stripe_id
  ON stripe_subscriptions (stripe_subscription_id);

-- Lookup by customer (for customer portal)
CREATE INDEX idx_stripe_subs_customer
  ON stripe_subscriptions (stripe_customer_id);

-- Lookup by Discord user (support queries)
CREATE INDEX idx_stripe_subs_discord_user
  ON stripe_subscriptions (discord_user_id);

-- === STRIPE CUSTOMER MAP ===
-- Maps Discord users to Stripe customers so returning users reuse their customer record.

CREATE TABLE stripe_customers (
  discord_user_id   TEXT PRIMARY KEY,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  email             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Step 2 — DAO Layer

New file: `src/dao/stripe_subscriptions.dao.ts`

```
Methods:
- findActiveByGuild(guildId: string): Promise<StripeSubscription | null>
- upsertFromWebhook(data: WebhookSubData): Promise<void>
- findByStripeSubscriptionId(stripeSubId: string): Promise<StripeSubscription | null>
- findByDiscordUser(discordUserId: string): Promise<StripeSubscription[]>
- cancelByStripeSubscriptionId(stripeSubId: string): Promise<void>
```

New file: `src/dao/stripe_customers.dao.ts`

```
Methods:
- findByDiscordUser(discordUserId: string): Promise<StripeCustomer | null>
- upsert(discordUserId: string, stripeCustomerId: string, email?: string): Promise<void>
```

### Step 3 — Stripe Service

New file: `src/services/stripe.service.ts`

Responsibilities:

- Initialize Stripe SDK with `STRIPE_SECRET_KEY`
- `createCheckoutSession(guildId, discordUserId, priceId)` — creates a Stripe Checkout Session with metadata `{ guild_id, discord_user_id }` baked in. Returns the checkout URL
- `createCustomerPortalSession(stripeCustomerId)` — returns a Stripe Customer Portal URL for managing/canceling subscriptions
- `handleWebhookEvent(event)` — processes webhook events and updates DB:
  - `checkout.session.completed` → create subscription record, map customer
  - `customer.subscription.updated` → update status, period dates, cancellation flag
  - `customer.subscription.deleted` → mark canceled
  - `invoice.payment_failed` → update status to `past_due`

**Dependency:** `stripe` npm package (official Stripe Node SDK)

### Step 4 — Webhook Endpoint

New file: `src/routes/stripe_webhook.ts` (or integrate into existing HTTP server if one exists)

SPRITEbot currently runs as a Discord bot process with no HTTP server. Two options:

**Option A — Minimal Express/Fastify server inside SPRITEbot:**

- Add a lightweight HTTP listener on a configurable port (e.g., 3100)
- Single route: `POST /api/stripe/webhook`
- Verify Stripe signature using `STRIPE_WEBHOOK_SECRET`
- Pass to `stripe.service.ts` handler
- Expose via reverse proxy on shinraedge2 (same pattern as other services)

**Option B — Separate microservice:**

- Standalone webhook receiver that shares the DB
- More isolation but more moving parts

**Recommendation:** Option A. SPRITEbot already runs 24/7 on shinralabs. Adding a single webhook route is minimal overhead and keeps the deployment simple.

**Reverse proxy config (shinraedge2 nginx):**

```
location /api/stripe/webhook {
    proxy_pass http://shinralabs:<SPRITEBOT_HTTP_PORT>/api/stripe/webhook;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Step 5 — Wire Into Entitlements

Modify `src/services/entitlements.service.ts`:

The existing `getEntitlementsFor()` checks `entitlements_cache` (Discord). Add a parallel check against `stripe_subscriptions`:

```typescript
// After existing Discord entitlement check:

// Check Stripe subscriptions
const stripeSub = await stripeSubsDAO.findActiveByGuild(guildId);
if (stripeSub && stripeSub.status === 'active') {
  // Stripe premium grants all premium features
  const features = new Set<FeatureKey>([
    'core',
    'rpg:characters',
    'rpg:inventory',
    'rpg:game-admin',
    'automation:thread-bump',
    'voice:transcription', // new feature key for transcription
  ]);
  return {
    status: 'active',
    planName: stripeSub.plan_name,
    features,
    expiresAt: stripeSub.current_period_end,
  };
}
```

This means `authorize.ts` and `guards.ts` **don't change at all**. They already call `getEntitlementsFor()` and check for features. Stripe just becomes another source of truth feeding the same pipeline.

### Step 6 — New Feature Key for Transcription

Update `src/access/features.ts`:

```typescript
export type FeatureKey =
  | 'core'
  | 'rpg:characters'
  | 'rpg:inventory'
  | 'rpg:game-admin'
  | 'automation:thread-bump'
  | 'voice:transcription'; // ← new

// Add to CommandPolicy:
export const CommandPolicy: Record<string, FeatureKey> = {
  // ... existing mappings ...
  transcribe: 'voice:transcription', // ← gate transcription behind premium
};

// Add to FEATURE_LABELS:
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  // ... existing ...
  'voice:transcription': 'Voice Transcription',
};
```

### Step 7 — Subscription Management Commands

New Discord slash commands for server admins:

```
/subscribe              — shows plan options, generates a Stripe Checkout link
/subscribe status       — shows current subscription status for this server
/subscribe manage       — generates a Stripe Customer Portal link (cancel/update card/etc)
```

Implementation notes:

- `/subscribe` generates a Stripe Checkout Session URL via `stripe.service.ts` and sends it as an ephemeral message (only the invoking user sees it)
- Checkout URL includes `guild_id` and `discord_user_id` in Stripe metadata so the webhook can associate the subscription with the right server
- `/subscribe status` checks `stripe_subscriptions` table for the current guild
- `/subscribe manage` looks up the Stripe customer for the invoking user and generates a Customer Portal session URL
- All three subcommands should be ephemeral (sensitive payment info shouldn't be public in chat)
- No feature gating on `/subscribe` itself — anyone in the server can view status, but only the original subscriber can manage via the portal

### Step 8 — Checkout Flow (Minimal Frontend)

The checkout page does NOT need to be complex. Stripe Checkout handles the entire payment UI. You just need a landing page that:

1. Accepts query params: `guild_id`, `plan` (monthly/quarterly/annual)
2. Calls your API to create a Checkout Session
3. Redirects to Stripe's hosted checkout page
4. Stripe redirects back to a success/cancel page after payment

This can be:

- A static HTML page with a few buttons that call your API
- A simple route on the SPRITEbot HTTP server that redirects
- Or skip the landing page entirely and have the Discord `/subscribe` command return a direct Stripe Checkout URL (simplest path)

**Recommendation:** Start with the simplest path — `/subscribe` returns a direct Stripe Checkout URL. No custom frontend needed initially. Add a landing page later if conversion matters.

---

## Deployment Checklist

### New Environment Variables (add to Infisical `spritebot` project)

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_MONTHLY=price_...
STRIPE_PRICE_QUARTERLY=price_...
STRIPE_PRICE_ANNUAL=price_...
SPRITEBOT_HTTP_PORT=3100
SPRITEBOT_PUBLIC_URL=https://sprite.comfyops.net  # or wherever the webhook lives
```

### Docker Changes

- Expose the HTTP port in `docker-compose.yml` (internally, nginx on shinraedge2 handles external TLS)
- No other container changes needed

### Nginx (shinraedge2)

- Add reverse proxy rule for the webhook endpoint
- TLS is already handled by the existing nginx config for comfyops.net (or add a new server block for the chosen domain)

### Testing Flow

1. Use Stripe test mode (`sk_test_` keys) throughout development
2. Use Stripe CLI (`stripe listen --forward-to localhost:3100/api/stripe/webhook`) for local webhook testing
3. Create a test subscription, verify:
   - `stripe_subscriptions` row created with correct guild_id
   - `getEntitlementsFor()` returns premium features for that guild
   - Gated commands (e.g., `/transcribe`) work
4. Cancel the test subscription, verify:
   - Status updated to `canceled`
   - Gated commands are denied
5. Test `past_due` flow: Stripe test mode has cards that simulate failures
6. Switch to live keys (`sk_live_`) only after all flows pass in test mode

---

## Implementation Order

| Phase   | What                                                                | Depends On |
| ------- | ------------------------------------------------------------------- | ---------- |
| **S0**  | mads: Stripe account, products, prices, API keys, Infisical secrets | Nothing    |
| **S1**  | DB migration: `stripe_subscriptions` + `stripe_customers` tables    | Nothing    |
| **S2**  | DAO layer for both new tables                                       | S1         |
| **S3**  | Stripe service (`stripe.service.ts`) + SDK integration              | S0, S2     |
| **S4**  | HTTP server + webhook endpoint in SPRITEbot                         | S3         |
| **S5**  | Wire Stripe into `entitlements.service.ts`                          | S2         |
| **S6**  | Add `voice:transcription` feature key + gate `/transcribe`          | S5         |
| **S7**  | `/subscribe` command (checkout + status + manage)                   | S3, S4     |
| **S8**  | Nginx reverse proxy for webhook                                     | S4         |
| **S9**  | End-to-end test in Stripe test mode                                 | All above  |
| **S10** | Go live: swap to `sk_live_` keys                                    | S9         |

S1-S2 and S0 can run in parallel. S5 and S6 can be done together. S3 and S4 are the core Stripe work. Total estimated effort: 2-3 focused sessions for a Codex agent, plus mads's manual Stripe setup (S0).

---

## Future Considerations (Not In Scope)

- **Discord App Subscriptions as secondary payment path** — the entitlement framework supports both; just needs `PLAN_FEATURES` populated with real SKU IDs
- **Usage-based billing** — if transcription costs scale, could add per-minute metering on top of the flat subscription
- **Free trial** — Stripe supports trial periods natively; add `trial_period_days` to the checkout session creation
- **Referral/promo codes** — Stripe Coupons + Promotion Codes, apply at checkout
- **Multi-tier plans** — if features diverge enough to warrant separate tiers (e.g., RPG-only vs RPG+Voice), add more Price IDs and map them to different feature sets in `entitlements.service.ts`
- **Dunning/grace period** — Stripe Smart Retries handle most failed payment recovery automatically; consider a 3-day grace period before revoking access on `past_due`

---

## Open Questions

1. **Domain for webhook endpoint?** Needs to be publicly reachable by Stripe. Options: `sprite.comfyops.net`, `api.comfyops.net/sprite`, new domain. mads to decide.
2. **Grace period on failed payments?** Stripe will retry, but should we immediately revoke access on first failure or give a 3-7 day grace? Recommendation: 3-day grace (Stripe's default retry schedule handles most recoverable failures within 3 days).
3. **Free tier limits on transcription?** Current plan gates transcription entirely behind premium. Alternative: allow N free transcription minutes per month to let servers try it before buying. Could add later without schema changes.
4. **Email collection?** Stripe Checkout can collect email for receipts. Useful for payment confirmations but adds a data handling obligation. Recommendation: let Stripe handle it (they collect email by default for receipts).
