# SPRITEbot Access Tier Audit & Restructuring

> **Status:** Implemented
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

| Command             | Rationale                     |
| ------------------- | ----------------------------- |
| `/view-game`        | Read-only                     |
| `/list-games`       | Read-only                     |
| `/view-character`   | Read-only                     |
| `/list-characters`  | Read-only                     |
| `/join-game`        | Navigation (no state created) |
| `/switch-game`      | Navigation                    |
| `/switch-character` | Navigation                    |
| `/roll`             | Stateless, good free hook     |

Components: all view/paginate/cancel/navigate interactions stay `core`.

### Premium (`rpg:characters`, `rpg:inventory`, `rpg:game-admin`, `automation:thread-bump`)

Everything that creates or mutates state. One subscription unlocks all
premium features for the entire server.

| Command              | Feature Key              | Rationale                                  |
| -------------------- | ------------------------ | ------------------------------------------ |
| `/create-game`       | `rpg:game-admin`         | Creates game state                         |
| `/create-character`  | `rpg:characters`         | Creates character state                    |
| `/restore-character` | `rpg:characters`         | Mutates character state                    |
| `/ic`                | `rpg:characters`         | Creates channel mode + webhook state       |
| `/ooc`               | `rpg:characters`         | Mutates channel mode state                 |
| `/ic-edit`           | `rpg:characters`         | Mutates proxied message                    |
| `Edit IC Message`    | `rpg:characters`         | Context menu, same as `/ic-edit`           |
| `/ic-delete`         | `rpg:characters`         | Deletes proxied message                    |
| `Delete IC Message`  | `rpg:characters`         | Context menu, same as `/ic-delete`         |
| `/inventory`         | `rpg:inventory`          | Creates/mutates inventory state            |
| `/bump-thread`       | `automation:thread-bump` | Creates scheduled state                    |
| `/bot-announcements` | `rpg:game-admin`         | Configures server-level notification state |

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

| Command          | Gate Mechanism               |
| ---------------- | ---------------------------- |
| `/admin`         | `OWNER_IDS` + `DEV_GUILD_ID` |
| `/gift`          | `OWNER_IDS` + `DEV_GUILD_ID` |
| `/toggle-bypass` | `OWNER_IDS` + `DEV_GUILD_ID` |

---

## Implemented Changes

### `src/access/features.ts`

The access policy now includes the Pro feature key and explicit mappings for stateful commands:

```typescript
export type FeatureKey =
  | 'core'
  | 'rpg:characters'
  | 'rpg:inventory'
  | 'rpg:game-admin'
  | 'automation:thread-bump'
  | 'pro:transcription'; // ← new

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  core: 'Core',
  'rpg:characters': 'Characters',
  'rpg:inventory': 'Inventory',
  'rpg:game-admin': 'Game Admin',
  'automation:thread-bump': 'Thread Bumping',
  'pro:transcription': 'Voice Transcription', // ← new
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
  roll: 'core', // ← new (explicit)

  // === Premium (stateful) ===
  'create-character': 'rpg:characters',
  'restore-character': 'rpg:characters',
  ic: 'rpg:characters', // ← new
  ooc: 'rpg:characters', // ← new
  'ic-edit': 'rpg:characters', // ← new
  'Edit IC Message': 'rpg:characters', // ← new
  'ic-delete': 'rpg:characters', // ← new
  'Delete IC Message': 'rpg:characters', // ← new
  'create-game': 'rpg:game-admin',
  'bot-announcements': 'rpg:game-admin', // ← new
  inventory: 'rpg:inventory',
  'bump-thread': 'automation:thread-bump',

  // === Pro ===
  transcribe: 'pro:transcription', // ← new
};
```

`/subscribe` intentionally stays outside `CommandPolicy` so servers without an active entitlement
can still open Discord's Premium App subscription UI.

### `src/access/components_policy.ts`

`restoreCharacterDropdown` is mapped through the component policy. No other component changes were
needed because the existing component gates already cover the interactive flows.

### Context menus (`ic-edit-context`, `ic-delete-context`)

The `Edit IC Message` and `Delete IC Message` context menu commands register by their Discord
command names, not by their filenames. `CommandPolicy` should include both human-facing command
names so the shared interaction guard applies the same `rpg:characters` gate as `/ic-edit` and
`/ic-delete`.

---

## Pricing (Stripe)

Update `plans/stripe-subscriptions.md` Step 0 to include Pro tier:

| Tier        | Price    | Billing                  | Features                        |
| ----------- | -------- | ------------------------ | ------------------------------- |
| **Free**    | $0       | —                        | `core` only                     |
| **Premium** | $3-28/yr | Monthly/Quarterly/Annual | All `rpg:*` + `automation:*`    |
| **Pro**     | TBD      | TBD                      | Everything in Premium + `pro:*` |

Pro tier pricing is deferred until transcription costs are better
understood. The feature key and gate should ship now so the access
framework is ready.

---

## Spriteweb Updates

Update `spriteweb/src/pages/pricing.astro` to reflect three tiers instead
of two (free vs premium). Add Pro tier card with "coming soon" or "contact
for pricing" messaging until the price point is decided.

---

## Implementation Record

This shipped as a small access-policy change with no new files, DB changes, or service changes.

1. Updated `features.ts` with the Pro feature key and command mappings
2. Verified context menu command names for IC edit/delete and added them to policy
3. Left spriteweb pricing updates for a separate PR

---

## Verification

After merge, confirm:

- `/roll` works in a free (ungifted, no entitlement) server
- `/ic` is denied in a free server with "requires subscription" message
- `Edit IC Message` and `Delete IC Message` are denied in a free server with the same message
- `/transcribe` is denied even in a premium server (unless Pro is granted)
- All existing gated commands still work in gifted/entitled servers
- `/admin`, `/gift`, `/toggle-bypass` still work for owner in ops guild
