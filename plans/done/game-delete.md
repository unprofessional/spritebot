# GM Game Deletion

**Status:** Completed and archived (production verified 2026-07-21).

Production verification on `shinralabs` confirmed that `public.game.deleted_at`
exists as a nullable `timestamp without time zone`. The live database contained
four soft-deleted games at verification time, confirming the deployed feature is
actively using the migrated column.

## Overview

Allow GMs to soft-delete their own games via the Discord UI, with a 30-day recovery window before permanent purge. Mirrors the existing character soft-delete pattern.

## Context

- Characters already have `deleted_at` soft-delete, 30-day auto-purge, and `/restore-character`.
- Games currently have a hard `DELETE` DAO method (`GameDAO.delete`) that is **unused** and not exposed anywhere.
- Game schema has `ON DELETE CASCADE` to `stat_template` and `character`, and `ON DELETE SET NULL` on `player_server_link.current_game_id`.
- The cleanup scheduler (`cleanup_scheduler.ts`) runs daily and calls `purgeSafeOrphans`, which already hard-deletes characters with `deleted_at > 30 days`.

## Dependency Chain on Delete

When a game is soft-deleted:

1. `game.deleted_at` is set
2. All characters under the game are soft-deleted (set their `deleted_at` too)
3. All `player_server_link.current_game_id` references are cleared (players switched off the game)
4. Stat templates become inaccessible (filtered by game active status)
5. Published game listings exclude soft-deleted games

When permanently purged (30+ days):

- Hard `DELETE FROM game WHERE id = $1` triggers CASCADE, removing stat_templates, characters, and downstream data

## Tasks

### 1. Schema: Add `deleted_at` to `game` table

- [x] New migration: `ALTER TABLE game ADD COLUMN deleted_at TIMESTAMP DEFAULT NULL`
- [x] Update `src/db/tables/tables.sql` with the new column

### 2. DAO: Soft delete + restore for games

- [x] `GameDAO.softDelete(gameId)` — sets `deleted_at = CURRENT_TIMESTAMP`, returns game
- [x] `GameDAO.restore(gameId)` — sets `deleted_at = NULL`, returns game
- [x] Update `GameDAO.findById`, `findByServer`, `findPublished` etc. to filter `deleted_at IS NULL`
- [x] Keep the existing hard `GameDAO.delete` for the purge path
- [x] Add `GameDAO.findExpiredSoftDeletes(days: number)` for the purge query

### 3. Service: Game deletion logic

- [x] `GameService.deleteGame(gameId, requesterId)` —
  - Verify requester is the GM (`game.gm_id === requesterId`)
  - Soft-delete the game
  - Soft-delete all active characters under the game (batch update)
  - Clear `player_server_link.current_game_id` for affected players
  - Return summary of what was affected (character count, player count)
- [x] `GameService.restoreGame(gameId, requesterId)` —
  - Verify requester is GM
  - Restore the game (`deleted_at = NULL`)
  - Restore characters that were soft-deleted at the same time as the game (use timestamp proximity or a `deleted_by_game` flag to avoid restoring independently-deleted characters)
  - Return summary

### 4. UI: Delete button on game view

Follow the character delete pattern exactly:

- [x] `delete_game_button.ts` — Danger-style button, `🗑️ Delete Game`, shown only to GM on game view card
- [x] `confirm_delete_game_button.ts` — Confirmation button with cancel option
- [x] Delete handler: ownership check → show confirmation with warning message
- [x] Confirm handler: ownership re-check → call `GameService.deleteGame` → show result with character/player counts affected
- [x] Warning text: _"⚠️ This will delete the game and all its characters. Players will be removed from the game. You have **30 days** to restore it before it is permanently removed. Use `/restore-game` to recover it."_
- [x] Register both handlers in `button_handlers/index.ts`

### 5. Command: `/restore-game`

- [x] New slash command mirroring `/restore-character`
- [x] Lists GM's soft-deleted games (within 30-day window)
- [x] Select menu to pick which game to restore
- [x] Calls `GameService.restoreGame`
- [x] Confirmation message with summary of restored characters

### 6. Purge: Extend cleanup scheduler

- [x] Add game purge to `purgeSafeOrphans` in `admin_housekeeping.service.ts`:
  ```sql
  DELETE FROM game
  WHERE deleted_at IS NOT NULL
    AND deleted_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
  ```
  (CASCADE handles stat_templates, characters, and downstream)
- [x] Add purge count to the cleanup log output

### 7. Admin: Update game audit

- [x] Update `/admin games` audit to show soft-deleted games separately
- [x] Include `deleted_at` date and days remaining before purge
- [ ] Optional: admin force-restore or force-purge commands (stretch)

### 8. Filter updates

Anywhere games are listed or accessed, ensure soft-deleted games are excluded:

- [x] `/list-games` — filter `deleted_at IS NULL`
- [x] `/join-game` — filter `deleted_at IS NULL`
- [x] `/view-game` — treat a stale deleted-game selection as unavailable
- [x] `/switch-game` — filter `deleted_at IS NULL`
- [x] Game publish/unpublish — block on soft-deleted games
- [x] Character creation — block on soft-deleted games

### 9. Tests

- [x] Integration tests for `GameDAO.softDelete` and `GameDAO.restore`
- [x] Integration tests for `GameService.deleteGame` cascade behavior
- [x] Integration tests for `GameService.restoreGame` (including character restoration logic)
- [x] Integration test for the purge query
- [x] Button handler tests following character delete test patterns

## Design Decisions

- **30-day window** matches existing character soft-delete retention. Configurable if needed later.
- **Cascade soft-delete to characters** ensures nothing is orphaned or accessible under a deleted game. Characters deleted this way should be restorable with the game.
- **Independent character deletes preserved** — if a player deleted their character before the GM deleted the game, restoring the game should NOT restore that character. Use timestamp comparison or a flag.
- **GM-only** — only the game creator can delete/restore. No player-initiated game deletion.
- **No admin purge override initially** — task 7 stretch goal, not blocking.

## Open Questions

- [x] Player DM notifications: no; keep deletion contained to the initiating interaction.
- [x] Delete entry point: button-only.
- [x] Retention window: 30 days, matching character restoration.
