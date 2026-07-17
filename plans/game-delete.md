# TODO: GM Game Deletion

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

- [ ] New migration: `ALTER TABLE game ADD COLUMN deleted_at TIMESTAMP DEFAULT NULL`
- [ ] Update `src/db/tables/tables.sql` with the new column

### 2. DAO: Soft delete + restore for games

- [ ] `GameDAO.softDelete(gameId)` — sets `deleted_at = CURRENT_TIMESTAMP`, returns game
- [ ] `GameDAO.restore(gameId)` — sets `deleted_at = NULL`, returns game
- [ ] Update `GameDAO.findById`, `findByServer`, `findPublished` etc. to filter `deleted_at IS NULL`
- [ ] Keep the existing hard `GameDAO.delete` for the purge path
- [ ] Add `GameDAO.findExpiredSoftDeletes(days: number)` for the purge query

### 3. Service: Game deletion logic

- [ ] `GameService.deleteGame(gameId, requesterId)` —
  - Verify requester is the GM (`game.gm_id === requesterId`)
  - Soft-delete the game
  - Soft-delete all active characters under the game (batch update)
  - Clear `player_server_link.current_game_id` for affected players
  - Return summary of what was affected (character count, player count)
- [ ] `GameService.restoreGame(gameId, requesterId)` —
  - Verify requester is GM
  - Restore the game (`deleted_at = NULL`)
  - Restore characters that were soft-deleted at the same time as the game (use timestamp proximity or a `deleted_by_game` flag to avoid restoring independently-deleted characters)
  - Return summary

### 4. UI: Delete button on game view

Follow the character delete pattern exactly:

- [ ] `delete_game_button.ts` — Danger-style button, `🗑️ Delete Game`, shown only to GM on game view card
- [ ] `confirm_delete_game_button.ts` — Confirmation button with cancel option
- [ ] Delete handler: ownership check → show confirmation with warning message
- [ ] Confirm handler: ownership re-check → call `GameService.deleteGame` → show result with character/player counts affected
- [ ] Warning text: _"⚠️ This will soft-delete the game and all its characters. Players will be removed from the game. You have **30 days** to restore it before it is permanently removed. Use `/restore-game` to recover it."_
- [ ] Register both handlers in `button_handlers/index.ts`

### 5. Command: `/restore-game`

- [ ] New slash command mirroring `/restore-character`
- [ ] Lists GM's soft-deleted games (within 30-day window)
- [ ] Select menu to pick which game to restore
- [ ] Calls `GameService.restoreGame`
- [ ] Confirmation message with summary of restored characters

### 6. Purge: Extend cleanup scheduler

- [ ] Add game purge to `purgeSafeOrphans` in `admin_housekeeping.service.ts`:
  ```sql
  DELETE FROM game
  WHERE deleted_at IS NOT NULL
    AND deleted_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
  ```
  (CASCADE handles stat_templates, characters, and downstream)
- [ ] Add purge count to the cleanup log output

### 7. Admin: Update game audit

- [ ] Update `/admin games` audit to show soft-deleted games separately
- [ ] Include `deleted_at` date and days remaining before purge
- [ ] Optional: admin force-restore or force-purge commands (stretch)

### 8. Filter updates

Anywhere games are listed or accessed, ensure soft-deleted games are excluded:

- [ ] `/list-games` — filter `deleted_at IS NULL`
- [ ] `/join-game` — filter `deleted_at IS NULL`
- [ ] `/view-game` — show "this game has been deleted" message if accessed by ID
- [ ] `/switch-game` — filter `deleted_at IS NULL`
- [ ] Game publish/unpublish — block on soft-deleted games
- [ ] Character creation — block on soft-deleted games

### 9. Tests

- [ ] Unit tests for `GameDAO.softDelete` and `GameDAO.restore`
- [ ] Unit tests for `GameService.deleteGame` cascade behavior
- [ ] Unit tests for `GameService.restoreGame` (including character restoration logic)
- [ ] Integration test for the purge query
- [ ] Button handler tests following character delete test patterns

## Design Decisions

- **30-day window** matches existing character soft-delete retention. Configurable if needed later.
- **Cascade soft-delete to characters** ensures nothing is orphaned or accessible under a deleted game. Characters deleted this way should be restorable with the game.
- **Independent character deletes preserved** — if a player deleted their character before the GM deleted the game, restoring the game should NOT restore that character. Use timestamp comparison or a flag.
- **GM-only** — only the game creator can delete/restore. No player-initiated game deletion.
- **No admin purge override initially** — task 7 stretch goal, not blocking.

## Open Questions

- [ ] Should players receive a DM notification when their game is deleted? (Characters are affected)
- [ ] Should there be a `/delete-game` slash command as an alternative to the button, or button-only?
- [ ] 30 or 60 day retention window? Character precedent is 30. mads mentioned 30-60.
