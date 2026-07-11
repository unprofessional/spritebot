# SPRITEbot Access Tier Audit & Restructuring

> **Status:** Planning
> **Target:** `src/access/features.ts`, `src/access/components_policy.ts`
> **Related:** `plans/stripe-subscriptions.md` (payment integration)

---

## Problem

The current `CommandPolicy` has gaps — several commands exist without
explicit feature key mappings, relying on implicit gating (e.g., RP proxy
commands are ungated but require a character that needs premium to create).
This is fragile. The tier structure also needs a third level for
resource-heavy features like voice transcription.

## Guiding Principle

**Anything stateful (writes to DB or creates external state) is premium.
Anything read-only or stateless is free.**

---

## Proposed Tier Structure

### Free (`core`)

Read-only browsing, navigation, and stateless utilities. The "try before
you buy" experience.

| Command              | Rationale                          |
| -------------------- | ---------------------------------- |
| `/view-game`         | Read-only                          |
| `/list-games`        | Read-only                          |
| `/view-character`    | Read-only                          |
| `/list-characters`   | Read-only                          |
| `/join-game`         | Navigation (no state created)      |
| `/switch-game`       | Navigation                         |
| `/switch-character`  | Navigation                         |
| `/roll`              | Stateless, good free hook          |

Components: all view/paginate/cancel/navigate interactions stay `core`.

### Premium (`rpg:characters`, `rpg:inventory`, `rpg:game-admin`, `automation:thread-bump`)

Everything that creates or mutates state. One subscription unlocks all
premium features for the entire server.

| Command              | Feature Key            | Rationale                              |
| -------------------- | ---------------------- | -------------------------------------- |
| `/create-game`       | `rpg:game-admin`       | Creates game state                     |
| `/create-character`  | `rpg:characters`       | Creates character state                |
| `/restore-character` | `rpg:characters`       | Mutates character state                |
| `/ic`                | `rpg:characters`       | Creates channel mode + webhook state   |
| `/ooc`               | `rpg:characters`       | Mutates channel mode state             |
| `/ic-edit`           | `rpg:characters`       | Mutates proxied message                |
| `Edit IC Message`    | `rpg:characters`       | Context menu, same as `/ic-edit`       |
| `/ic-delete`         | `rpg:characters`       | Deletes proxied message                |
| `/inventory`         | `rpg:inventory`        | Creates/mutates inventory state        |
| `/bump-thread`       | `automation:thread-bump` | Creates scheduled state              |
| `/bot-announcements` | `rpg:game-admin`       | Configures server-level notification state |

### Pro (`pro:transcription`)

Resource-intensive features that consume compute per-use. Separate tier,
higher price point (TBD).

| Command       | Feature Key         | Rationale                                     |
| ------------- | ------------------- | --------------------------------------------- |
| `/transcribe` | `pro:transcription` | Voice recording + processing, per-use compute |

### Ops-only (self-gated, no `CommandPolicy` entry needed)

These commands have their own internal owner/ops-guild checks and should
NOT be added to `CommandPolicy`. Adding them would be redundant and could
interfere with their existing permission logic.

| Command          | Gate Mechanism                    |
| ---------------- | --------------------------------- |
| `/admin`         | `OWNER_IDS` + `DEV_GUILD_ID`     |
| `/gift`          | `OWNER_IDS` + `DEV_GUILD_ID`     |
| `/toggle-bypass` | `OWNER_IDS` + `DEV_GUILD_ID`     |

---

## Code Changes

### `src/access/features.ts`

Add new feature key and fill in command policy gaps:

```typescript
export type FeatureKey =
  | 'core'
  | 'rpg:characters'
  | 'rpg:inventory'
  | 'rpg:game-admin'
  | 'automation:thread-bump'
  | 'pro:transcription';       // ← new

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  core: 'Core',
  'rpg:characters': 'Characters',
  'rpg:inventory': 'Inventory',
  'rpg:game-admin': 'Game Admin',
  'automation:thread-bump': 'Thread Bumping',
  'pro:transcription': 'Voice Transcription',  // ← new
};

export const CommandPolicy: Record<string, FeatureKey> = {
  // === Free (core) ===
  'view-character': 'core',
  'list-characters': 'core',
  'switch-character': 'core',
  'view-game': 'core',
  'list-games': 'core',
  'join-game': 'core',
  'switch-game': 'core',
  roll: 'core',                    // ← new (explicit)

  // === Premium (stateful) ===
  'create-character': 'rpg:characters',
  'restore-character': 'rpg:characters',
  ic: 'rpg:characters',           // ← new
  ooc: 'rpg:characters',          // ← new
  'ic-edit': 'rpg:characters',    // ← new
  'ic-delete': 'rpg:characters',  // ← new
  'create-game': 'rpg:game-admin',
  'bot-announcements': 'rpg:game-admin',  // ← new
  inventory: 'rpg:inventory',
  'bump-thread': 'automation:thread-bump',

  // === Pro ===
  transcribe: 'pro:transcription', // ← new
};
```

### `src/access/components_policy.ts`

Add the `restoreCharacterDropdown` entry (already present on develop).
No other component changes needed — the existing component gates already
cover all interactive flows correctly.

### Context menu (`ic-edit-context`)

The `Edit IC Message` context menu command registers with a different
command name than the slash command. Verify how it registers and ensure
the guard matches. If it registers as `ic-edit-context` or similar, add
that to `CommandPolicy` as `rpg:characters`.

---

## Pricing (Stripe)

Update `plans/stripe-subscriptions.md` Step 0 to include Pro tier:

| Tier         | Price     | Billing  | Features                                |
| ------------ | --------- | -------- | --------------------------------------- |
| **Free**     | $0        | —        | `core` only                             |
| **Premium**  | $3-28/yr  | Monthly/Quarterly/Annual | All `rpg:*` + `automation:*` |
| **Pro**      | TBD       | TBD      | Everything in Premium + `pro:*`         |

Pro tier pricing is deferred until transcription costs are better
understood. The feature key and gate should ship now so the access
framework is ready.

---

## Spriteweb Updates

Update `spriteweb/src/pages/pricing.astro` to reflect three tiers instead
of two (free vs premium). Add Pro tier card with "coming soon" or "contact
for pricing" messaging until the price point is decided.

---

## Implementation

Single pass — this is a small diff to `features.ts` and one context menu
verification. No new files, no DB changes, no service changes.

1. Update `features.ts` with new feature key and all command mappings
2. Verify context menu command name for `Edit IC Message`, add to policy
3. Run `npm run build` + `npm run precommit`
4. Update spriteweb pricing page (separate PR)

---

## Verification

After merge, confirm:

- `/roll` works in a free (ungifted, no entitlement) server
- `/ic` is denied in a free server with "requires subscription" message
- `/transcribe` is denied even in a premium server (unless Pro is granted)
- All existing gated commands still work in gifted/entitled servers
- `/admin`, `/gift`, `/toggle-bypass` still work for owner in ops guild
