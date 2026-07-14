# SPRITEbot Admin Housekeeping — Implementation Plan

> **Status:** Planning
> **Target:** SPRITEbot (TypeScript/Node, discord.js 14)

---

## Overview

Add admin-facing commands for database hygiene: detecting orphaned entities,
reviewing stale data, and performing cleanup. This covers both interactive
slash commands for on-demand inspection and automated background cleanup for
data that accumulates silently.

The spritebot database also shares space with SPRITE-Integrations tables
(`campaigns`, `characters` (plural), `character_stats`, `campaign_creatures`,
`stat_template_mapping`, `webhook_events`, `lifecycle_notification_channels`).
These are out of scope for SPRITEbot commands but noted here so we don't
accidentally miss cross-system orphans in future work.

---

## Commands

### `/admin orphans` — Orphan Detection

**Who:** Bot owner only (ops guild gated, same pattern as `/toggle-bypass`
and `/gift`).

**What it reports:**

| Category                         | Query Logic                                                                                                                                                                      | Label                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Abandoned games**              | Games with `is_public = false`, no stat templates, and no characters. Stale if `created_at` > 7 days ago.                                                                        | `🎲 Abandoned games (unpublished, no stats, no characters)` |
| **Empty published games**        | Games with `is_public = true` but zero characters (no one joined). Stale if `created_at` > 30 days ago.                                                                          | `📢 Published games with no players`                        |
| **Orphaned player_server_links** | Links where `current_game_id` or `current_character_id` point to non-existent entities (shouldn't happen with FK SET NULL, but belt-and-suspenders).                             | `🔗 Orphaned player links`                                  |
| **Soft-deleted characters**      | Characters where `deleted_at IS NOT NULL` and older than 30 days. These are safe to hard-delete.                                                                                 | `🪦 Soft-deleted characters (>30 days)`                     |
| **Stale rp_proxy_messages**      | Proxy message mappings older than 90 days. These grow unbounded and are only needed for `/ic-edit` and `/ic-delete` lookups.                                                     | `📨 Stale proxy message mappings (>90 days)`                |
| **Stale rp_channel_modes**       | IC mode flags where `updated_at` is older than 90 days. Users likely forgot they toggled IC in a channel months ago.                                                             | `🎭 Stale IC channel modes (>90 days)`                      |
| **Expired gifted guilds**        | Rows in `gifted_guilds` where `expires_at < now()`.                                                                                                                              | `🎁 Expired gift entries`                                   |
| **Expired entitlements**         | Rows in `entitlements_cache` with `status = 'expired'` or `status = 'canceled'` older than 90 days.                                                                              | `💳 Stale entitlement cache entries`                        |
| **Dead thread bumps**            | Thread bumps where the bot can no longer see the thread (thread deleted or bot removed from channel). Requires a Discord API check per thread — cap at 25 checks per invocation. | `📌 Dead thread bumps`                                      |

**Response format:** Ephemeral embed with each category as a field. Show
count + up to 3 example rows (game name, character name, etc.) per category.
If everything is clean, show a single "✅ No orphans detected" message.

**Subcommands:**

- `/admin orphans` — show the full report
- `/admin orphans-purge` — actually delete the detected orphans (with
  confirmation button). Only purges categories marked safe for auto-cleanup
  (soft-deleted characters, stale proxy messages, stale IC modes, expired
  gifts, expired entitlements). Abandoned/empty games require manual review
  since a GM might just be slow to set up.

### `/admin games` — Game Audit (Per-Server)

**Who:** Bot owner (any guild) or GM (own guild only).

**What it shows:**

- All games in the current guild with:
  - Name, publish status, created_by, created_at
  - Stat template count
  - Character count (total / public / private)
  - Last activity (most recent `character.last_updated_at` or
    `game.updated_at`)
- Highlights games with no activity in 60+ days

This gives GMs visibility into their own server's health and lets the bot
owner audit any server.

### `/admin global-stats` — Global Usage Snapshot

**Who:** Bot owner only.

**What it shows:**

- Current number of Discord servers the bot is in, from the live Discord
  client cache
- Active paid subscriber guilds from `entitlements_cache`
- Active gifted guilds from `gifted_guilds`
- Distinct active access guilds, using a union of active paid entitlements
  and active gifts so overlap is counted once
- Public games / total games
- Public characters / active non-deleted characters
- Linked players

This is an internal health snapshot for owner/admin use, not an external
analytics surface.

### `/admin characters` — Private Character Audit

**Who:** Bot owner (all guilds) or GM (own game only).

**What it shows:**

- Characters with `visibility = 'private'` in the target game/guild
- Grouped by game, showing: character name, owner (Discord user), created_at,
  whether any stats have been filled in
- Highlights characters that are private with zero stat fields filled
  (likely abandoned during creation)

This lets GMs nudge players to publish their characters or clean up
incomplete drafts.

---

## Soft-Delete User Communication

Any user-facing action that soft-deletes data **must** inform the user of the
retention window and how to recover it. This applies to existing delete flows
(e.g. character deletion via `confirm_delete_character_button`) and any
future delete operations.

### Requirements

1. **On soft-delete:** The confirmation/success message must include:

   ```
   ⚠️ This character has been deleted. You have **30 days** to restore it
   before it is permanently removed. Use `/restore-character` to recover it.
   ```

   Adjust the entity name and command as appropriate.

2. **On hard-delete (admin purge):** The purge confirmation must show:
   - Exactly what will be permanently deleted
   - That this is irreversible
   - Counts per category

3. **Recovery command:** A user-facing `/restore-character` that lets the
   original owner recover their own soft-deleted characters within the
   retention window, plus an admin-level override.

### Recovery Flow

**File:** `src/commands/restore-character.ts` (user-facing)

- Shows a dropdown of the user's own soft-deleted characters in the current
  game (where `deleted_at IS NOT NULL` and within 30 days)
- On selection: sets `deleted_at = NULL`, restores visibility to `private`
- Replies with confirmation + nudge to `/view-character`

**File:** `src/handlers/admin_restore.handler.ts` (admin-facing)

- `/admin restore-character <id>` — admin override to restore any character
  regardless of ownership
- `/admin restore-game <id>` — if we ever add game soft-delete

### Files to Update (Existing)

- `src/components/confirm_delete_character_button.ts` — add retention
  window messaging to the success response
- Any future delete flows must follow this same pattern

### Retention Periods

| Entity     | Soft-Delete Window | After Expiry                      |
| ---------- | ------------------ | --------------------------------- |
| Characters | 30 days            | Hard-deleted by cleanup scheduler |
| Games      | N/A (manual only)  | No soft-delete yet                |
| Other      | N/A                | Operational data, auto-cleaned    |

---

## Background Cleanup (Automated)

### Scheduled Purge Task

A lightweight scheduled task (same pattern as `bump_scheduler.ts`) that runs
daily and automatically cleans up data that is unambiguously stale:

| What                       | Condition                                                               | Action                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Soft-deleted characters    | `deleted_at` older than 30 days                                         | Hard delete (CASCADE handles stat_fields, inventory, custom_fields). **Only runs after the 30-day user recovery window.** |
| Stale rp_proxy_messages    | `created_at` older than 90 days                                         | Delete                                                                                                                    |
| Stale rp_channel_modes     | `updated_at` older than 90 days                                         | Delete                                                                                                                    |
| Expired entitlements cache | `status IN ('expired', 'canceled')` AND `updated_at` older than 90 days | Delete                                                                                                                    |
| Expired gifted guilds      | `expires_at < now()`                                                    | Delete                                                                                                                    |

**What it does NOT auto-delete:**

- Games (even abandoned ones) — always require manual review
- Characters that are private but not soft-deleted — GMs should decide
- Player/player_server_link rows — harmless and needed for returning users
- Thread bumps — need Discord API check, not suited for background batch

### Implementation

**File:** `src/schedulers/cleanup_scheduler.ts`

```ts
// Runs once daily (configurable via CLEANUP_INTERVAL_HOURS env var)
// Logs counts to console, no Discord notifications
// Uses a single transaction for all deletes
```

Register in `src/index.ts` alongside the existing bump scheduler.

---

## Legacy Table Audit

The database contains tables from SPRITE-Integrations that share the same
Postgres instance:

| Table                             | Owner               | Notes                                                    |
| --------------------------------- | ------------------- | -------------------------------------------------------- |
| `campaigns`                       | SPRITE-Integrations | TaleSpire campaign config                                |
| `characters` (plural)             | SPRITE-Integrations | TaleSpire creature-to-Discord mappings                   |
| `character_stats`                 | SPRITE-Integrations | TaleSpire stat snapshots                                 |
| `campaign_creatures`              | SPRITE-Integrations | Auto-discovered TaleSpire creatures                      |
| `stat_template_mapping`           | SPRITE-Integrations | TaleSpire → SPRITEbot stat mapping rules                 |
| `webhook_events`                  | SPRITE-Integrations | Inbound webhook event log                                |
| `lifecycle_notification_channels` | SPRITE-Integrations | Duplicate of `lifecycle_notification_channel` (singular) |

**Recommendations:**

- `lifecycle_notification_channels` (plural) appears to be a legacy duplicate
  of `lifecycle_notification_channel` (singular). Verify which one is
  actively used and drop the other.
- `webhook_events` has 0 rows — confirm if it's still being written to or
  can be dropped.
- These tables should NOT be touched by SPRITEbot's cleanup scheduler.
  SPRITE-Integrations should own its own housekeeping.

### Pass 5 Audit Result

Verified on July 10, 2026 from the current SPRITEbot and
SPRITE-Integrations source trees, plus a read-only count check against the
shared `spritebot` Postgres database on `shinralabs`.

**Findings:**

- SPRITEbot actively uses the singular
  `lifecycle_notification_channel` table through
  `src/dao/lifecycle_notification_channel.dao.ts`.
- SPRITE-Integrations actively uses the plural
  `lifecycle_notification_channels` table through
  `spritebot-integrations/src/dao/lifecycle_notification_channel.dao.ts`.
  It is not dead or duplicate from that repo's perspective.
- The live database currently has rows in both lifecycle tables:
  - `lifecycle_notification_channel`: 1 row
  - `lifecycle_notification_channels`: 1 row
- `webhook_events` is defined by SPRITE-Integrations and truncated by its
  test reset helper, but no current SPRITE-Integrations source code inserts
  into or reads from it.
- The live database currently has `webhook_events`: 0 rows.

**Recommendation:**

- Do not touch `lifecycle_notification_channels` from SPRITEbot. It is owned
  and actively used by SPRITE-Integrations.
- Do not include `webhook_events` in SPRITEbot cleanup. It is also owned by
  SPRITE-Integrations, even though it appears unused today.
- Follow up in SPRITE-Integrations with one of two outcomes:
  - remove `webhook_events` if webhook event logging is intentionally
    abandoned, or
  - add a small retention policy there if webhook logging is still planned.

No SPRITEbot code changes are required for this pass.

---

## Delivery Plan

This is intentionally split into multiple passes. The full plan mixes
read-only reporting, irreversible hard deletes, recovery UX, and a background
scheduler; bundling those into one PR makes review riskier than the feature
needs to be.

### Pass 1: Read-only admin audits

**Goal:** Ship useful visibility with no destructive actions.

Includes:

- `/admin orphans` read-only report
- `/admin games` per-server game audit
- `/admin characters` private-character audit
- Owner/ops-guild gate for orphan reports
- Owner/GM scope checks for game and character audits
- Integration coverage for audit SQL

Does **not** include purge buttons, hard deletes, restore commands, or
background cleanup.

### Pass 2: Purge preview and confirmation

**Goal:** Add explicit, reviewed destructive cleanup for categories that are
safe to purge.

Includes:

- `/admin orphans-purge` preview mode
- Confirmation button with irreversible-action copy
- Purge execution for only safe categories:
  - soft-deleted characters older than 30 days
  - stale proxy messages
  - stale IC channel modes
  - expired gift entries
  - stale entitlement cache rows
- Post-purge results summary
- Integration tests proving unsafe categories are not purged

Does **not** include background automation.

### Pass 3: Character restore and retention messaging

**Goal:** Make soft-delete user communication honest before any automated
hard-delete exists.

Includes:

- Update character delete confirmation/success copy with the 30-day recovery
  window
- `/restore-character` user-facing recovery flow for the original owner
- Admin override restore command for characters
- Tests around ownership, retention windows, and restored visibility

### Pass 4: Background cleanup scheduler

**Goal:** Automate only the cleanup already proven safe and recoverable.

Includes:

- `cleanup_scheduler.ts`
- `CLEANUP_INTERVAL_HOURS`
- Daily cleanup transaction
- Console logging of counts
- Registration from `src/index.ts`
- Tests for scheduler/service behavior

### Pass 5: Legacy table audit

**Goal:** Document or hand off cross-system cleanup to SPRITE-Integrations
without touching those tables from SPRITEbot.

Includes:

- Verify whether `lifecycle_notification_channels` plural is still used
- Verify whether `webhook_events` is still written
- Create a follow-up plan or issue in the owning repo

---

## Task Breakdown

### Task 1: Orphan detection service

**File:** `src/services/admin_housekeeping.service.ts`

Pure service that runs the orphan detection queries and returns structured
results. No Discord awareness. Each check is a separate function that
returns `{ category: string, count: number, examples: Array<{ id, name, detail }> }`.

**Delivery pass:** Pass 1 for read-only detection. Delete methods are deferred
to Pass 2.

### Task 2: `/admin orphans` command + handler

**Files:**

- `src/commands/admin.ts` — slash command with `orphans` and `orphans-purge`
  subcommands
- `src/handlers/admin_orphans.handler.ts` — calls service, formats embed

Gate to owner only + ops guild (same as `/gift`).

**Delivery pass:** Pass 1 for read-only report. The `purge` subcommand is
deferred to Pass 2.

### Task 3: Purge confirmation flow

**Files:**

- `src/components/confirm_purge_button.ts` — confirmation button component
- Wire into handler routing in `src/handlers/button_handlers.ts`

When `/admin orphans-purge` is run, show the orphan report with a
"⚠️ Confirm Purge" button. Button click executes the deletes and shows
results.

**Delivery pass:** Pass 2.

### Task 4: `/admin games` command

**Files:**

- `src/commands/admin.ts` — add `games` subcommand
- `src/handlers/admin_games.handler.ts`

Uses existing game/character services where possible, adds a
`getGameAudit(guildId)` function to the housekeeping service for the
aggregated view.

**Delivery pass:** Pass 1.

### Task 5: `/admin characters` command

**Files:**

- `src/commands/admin.ts` — add `characters` subcommand
- `src/handlers/admin_characters.handler.ts`

Add `getPrivateCharacterAudit(guildId, gameId?)` to the housekeeping
service.

**Delivery pass:** Pass 1.

### Task 6: Cleanup scheduler

**File:** `src/schedulers/cleanup_scheduler.ts`

Register in `src/index.ts`. Daily interval, single transaction, console
logging only.

**Delivery pass:** Pass 4, after Pass 2 and Pass 3 establish safe purge and
restore semantics.

### Task 7: Tests

- Unit tests for the housekeeping service (mock DB responses)
- Integration tests for orphan detection queries against PGlite
- Unit tests for the cleanup scheduler logic (mock service calls)

**Delivery pass:** Added incrementally per pass. Pass 1 emphasizes integration
tests for read-only SQL; Pass 2 adds purge safety tests; Pass 3 adds restore
authorization/retention tests; Pass 4 adds scheduler tests.

---

## Out of Scope

- **Cross-bot cleanup** — SPRITE-Integrations tables are not touched
- **User-facing commands** — these are admin/GM only
- **Data export** — no CSV/JSON dump of orphaned data (just view + purge)
- **Notifications** — cleanup scheduler logs to console, doesn't DM or
  post to channels
