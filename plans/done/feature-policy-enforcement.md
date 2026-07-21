# Plan: Feature Policy Enforcement

> **Status:** Completed and archived (2026-07-21)

## Problem

New commands and component handlers can ship without an entry in the feature policy map. When this happens, those interactions bypass entitlement gating entirely and rely only on ownership checks. This was caught manually during the game-delete review — the delete/confirm/restore component IDs were missing `rpg:game-admin` policies.

## Goal

Make CI fail when any registered command or component handler is missing a feature policy entry. No silent defaults — every handler must explicitly declare its feature tier.

## Approach

**Test-based enforcement** (not ESLint). This is a data completeness check, not a code pattern check.

### What the test does

1. Scan all slash commands from `src/commands/` (extract `.setName()` values)
2. Scan all button handler patterns from `src/handlers/button_handlers/index.ts`
3. Scan all select menu handler patterns from `src/handlers/select_menu_handlers/index.ts`
4. Scan all modal handler patterns if a modal handler index exists
5. Cross-reference every registration against `CommandPolicy` and `ComponentPolicy` maps in `src/access/features.ts`
6. Fail with a clear message listing unmapped handlers

### Policy map changes

- `CommandPolicy` already exists for slash commands
- `ComponentPolicy` (or equivalent) needs to exist for button/select/modal custom ID prefixes
- Every entry maps to a `FeatureKey` or the explicit `public` policy — there is no implicit or
  `unknown` escape hatch
- Read-only navigation (like `goBackToCharacter`, `goBackToGame`) maps to `core`
- Mutating actions map to their respective feature tier

### What "mapped" means

- For commands: the command name string exists as a key in `CommandPolicy`
- For components: the custom ID prefix (regex pattern or string prefix) exists as a key in the component policy map

## Tasks

- [x] 1. Create or extend the component policy map in `src/access/features.ts`
- [x] 2. Ensure all existing component handlers have entries (audit current state)
- [x] 3. Write the enforcement test that cross-references registrations against policy maps
- [x] 4. Verify CI catches a simulated missing entry (add a fake handler, confirm test fails, remove it)

## Notes

- This mirrors the Discord boundary ESLint rule in spirit but uses a test because it's checking data completeness, not code patterns
- Context menu commands (`Edit IC Message`, `Delete IC Message`) should be covered too
- The test should print exactly which handlers are missing so the fix is obvious
