# SPRITEbot Onboarding Nudges — Implementation Plan

> **Status:** Planning
> **Target:** SPRITEbot (TypeScript/Node, discord.js 14)
> **Pattern:** Guided "what's next" nudges on every command response, modeled after SPRITE-Integrations' admin setup flow

---

## Overview

Every SPRITEbot command response should **nudge the user toward the next logical step**. Right now, success messages are dead ends ("✅ Created game") and empty states are sometimes helpful ("Use `/join-game`") but inconsistent. The goal is a coherent guided flow where a brand-new server admin or player can go from zero to roleplaying without reading any docs.

### Design Principles

1. **Every response answers "what do I do next?"** — success, empty state, and error messages all include a contextual nudge.
2. **Nudges are role-aware** — GMs see GM next-steps, players see player next-steps.
3. **Nudges are state-aware** — if stats are already defined, don't nudge to define stats. If the game is already published, nudge toward sharing with players instead.
4. **Keep it light** — one or two lines, not a wall of text. Use `💡` prefix for nudge lines so they're visually distinct and greppable.
5. **Nudges go in a shared utility** — not inlined per-command. One source of truth for the flow graph.

---

## The Flow Graph

Two parallel tracks converge at `/ic`:

```
GM Track                              Player Track
─────────                             ────────────
/create-game                          /list-games
    │                                     │
    ▼                                     ▼
Define Stats (button)                 /join-game
    │                                     │
    ▼                                     ▼
Toggle Publish                        /create-character
    │                                     │
    ▼                                     ▼
(share with players)                  /switch-character (if multi)
                                          │
                                          ▼
                                      /ic → start roleplaying
                                          │
                                          ▼
                                      /roll, /ic-edit, /ic-delete, /inventory
```

---

## Task Breakdown

### Task 1: Create the nudge utility

**File:** `src/utils/onboarding_nudge.ts`

A single module that exports nudge-building functions. Each function takes relevant state and returns a string (or `null` if no nudge applies).

```ts
interface NudgeContext {
  userId: string;
  guildId: string;
  gameId?: string;
  isGM?: boolean;
  gameIsPublished?: boolean;
  hasStatTemplates?: boolean;
  hasCharacters?: boolean;
  hasActiveCharacter?: boolean;
  isInIC?: boolean;
}

// Returns a formatted nudge string like:
// "💡 Next up: define your game's stat fields using the **➕ Add Another Stat** button above."
function buildNudge(context: NudgeContext, trigger: string): string | null;
```

The `trigger` parameter identifies which command/action just completed (e.g. `"create-game"`, `"join-game"`, `"submit-character"`). The function looks up the next step based on trigger + context state.

**Nudge map:**

| Trigger                    | Condition                               | Nudge                                                                                                                              |
| -------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `create-game`              | No stat templates defined               | `💡 Next: define your game's stat fields with the **➕ Add Another Stat** button, then publish when ready.`                        |
| `create-game`              | Stats exist but unpublished             | `💡 Your stats are set up! Hit **📣 Toggle Visibility** to publish so players can join.`                                           |
| `define-stat`              | Still adding stats                      | `💡 Add more stats or hit **↩️ Cancel / Go Back** when you're done to return to the game overview.`                                |
| `finish-stat-setup`        | Game not published                      | `💡 Stats look good! When you're ready for players, hit **📣 Toggle Visibility** to publish.`                                      |
| `toggle-publish`           | Game just went public                   | `💡 Your game is live! Players can now use \`/join-game\` to join and \`/create-character\` to get started.`                       |
| `toggle-publish`           | Game just went private                  | `💡 Game is now private. No new players can join until you publish again.`                                                         |
| `list-games-empty`         | No games in server                      | `💡 No games yet! A GM can start one with \`/create-game\`.`                                                                       |
| `list-games`               | Has games, user not in one              | `💡 Want to join? Use \`/join-game\` to pick a game.`                                                                              |
| `join-game`                | User has no characters                  | `💡 You're in! Now create your character with \`/create-character\`.`                                                              |
| `join-game`                | User has characters (from another game) | `💡 Joined! Use \`/create-character\` to make a new character for this game, or \`/switch-character\` if you already have one.`    |
| `submit-character`         | Character created, not in IC            | `💡 Character ready! Use \`/ic\` in an RP channel to start posting in-character.`                                                  |
| `switch-character`         | Character switched                      | `💡 Now playing as your selected character. Use \`/ic\` to enter in-character mode in any channel.`                                |
| `ic`                       | Just enabled IC mode                    | `💡 You're in-character! Your messages in this channel will now proxy through your active character. Use \`/ooc\` to switch back.` |
| `create-character-no-game` | No active game                          | `💡 You need to join a game first. Use \`/join-game\` to pick one.` (already exists, just standardize format)                      |
| `view-character-none`      | No characters at all                    | `💡 You don't have a character yet. Use \`/create-character\` to make one.`                                                        |

### Task 2: Wire nudges into command responses

Update each command/component handler to call `buildNudge()` and append the result to the response content. **This is the bulk of the work** — touching every file listed below but each change is small (fetch context → call nudge → append to content).

**Files to update:**

| File                                          | What Changes                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/commands/create-game.ts`                 | Replace hardcoded setup instructions with nudge. Keep the stat field explanation, add contextual nudge at the bottom.               |
| `src/commands/list-games.ts`                  | Add nudge to empty state (`📭 No games found` → include `💡 ...create-game`). Add nudge to populated state for users not in a game. |
| `src/commands/join-game.ts`                   | No change to command itself (delegates to selector).                                                                                |
| `src/components/join_game_selector.ts`        | After successful join in `handle()`, append nudge for `/create-character`. Update empty state message with nudge.                   |
| `src/commands/create-character.ts`            | Error states already nudge (good). No changes needed unless standardizing format.                                                   |
| `src/components/submit_character_button.ts`   | After successful creation, append nudge for `/ic`.                                                                                  |
| `src/components/toggle_publish_button.ts`     | After toggle, append state-aware nudge (public vs private).                                                                         |
| `src/components/finish_stat_setup_button.ts`  | After returning to game overview, append nudge about publishing if not yet public.                                                  |
| `src/commands/view-game.ts`                   | For GMs viewing unpublished game: nudge to publish. For GMs with no stats: nudge to define stats.                                   |
| `src/commands/view-character.ts`              | Error states already nudge. Standardize format.                                                                                     |
| `src/commands/list-characters.ts`             | Empty state: nudge to `/create-character`.                                                                                          |
| `src/commands/ic.ts`                          | Append nudge about `/ooc` to switch back.                                                                                           |
| `src/commands/ooc.ts`                         | Append nudge about `/ic` to switch back.                                                                                            |
| `src/commands/switch-character.ts`            | No change to command (delegates to selector).                                                                                       |
| `src/components/switch_character_selector.ts` | After successful switch, append nudge for `/ic`.                                                                                    |
| `src/components/switch_game_selector.ts`      | After successful switch, append nudge for `/create-character` or `/ic` depending on character state.                                |

### Task 3: Standardize error/empty state messages

Audit all commands for inconsistent phrasing. Normalize to this pattern:

```
⚠️ [What went wrong / what's missing]
💡 [What to do about it]
```

Currently some commands say "Use `/join-game` to select one" inline in the warning, others just say "No games found" with no guidance. Make them all consistent.

**Specific fixes:**

- `list-games.ts` empty state: `📭 No games found in this server.` → append `💡 A GM can start one with \`/create-game\`.`
- `list-characters.ts` empty state: `📭 No public characters found in your current game.` → append `💡 Create yours with \`/create-character\`.`
- `join_game_selector.ts` empty state: already has helpful text about GM, keep it, add `💡 If you're the GM, your game might need to be published first (\`/view-game\` to check).`

### Task 4: Tests

Add unit tests for the nudge utility:

**File:** `tests/unit/utils/onboarding_nudge.test.ts`

- Test each trigger + context combo returns the expected nudge string.
- Test that triggers with no applicable nudge return `null`.
- Test that nudges are role-aware (GM vs player contexts).

No integration test changes needed — the nudges are pure string appends to existing responses.

---

## Out of Scope

- **Buttons that auto-run the next command** — nudges are text hints, not interactive wizards. The existing button flows (define stats, toggle publish) stay as-is.
- **DM-based onboarding** — all nudges are ephemeral in-channel, same as current behavior.
- **Progress tracker / checklist embed** — tempting but over-engineered for now. Could be a follow-up.
- **Slash command autocomplete changes** — nudges are post-action, not pre-action.

---

## Implementation Notes

- All nudges are ephemeral (same as their parent messages). Players never see each other's nudges.
- The nudge utility should be pure (no DB calls). Callers fetch the state they already need for the command and pass it in. This keeps the utility testable and avoids extra queries.
- Use `\`/command-name\`` formatting in nudge text so Discord renders them as inline code (slash commands aren't linkable in ephemeral messages).
- Keep nudge text short — one line preferred, two max. Don't repeat information that's already in the command response.
