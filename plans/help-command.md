# Plan: `/help` Command

> **Status:** Implemented — merge pending

## Goal

Give users an intuitive, guided help experience instead of a wall of commands. No one should need to google how to use SPRITE.

## Design Philosophy

- **No info dumps.** The initial `/help` response should be dead simple.
- **Progressive disclosure.** Two taps max to find what you need.
- **Role-scoped.** Players and GMs see different commands — don't confuse players with GM tools and vice versa.
- **In-place updates.** The embed updates itself when you interact. No message spam.

## UX Flow

### Step 1: Role Selection

`/help` sends an ephemeral embed with two buttons:

```
🎮 Welcome to SPRITE

Pick your role to see the commands that matter to you.

[🎮 I'm a Player]  [🛡️ I'm a GM / Server Admin]
```

That's it. No command list, no feature breakdown. Just two buttons.

### Step 2: Category Menu

After picking a role, the embed updates in-place. A select menu appears with categories scoped to their role.

**Player categories:**

| Category            | Emoji | Commands                                                                                              |
| ------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| Getting Started     | 🚀    | Guided walkthrough (not a command list — explains the join → character → play flow)                   |
| Games               | 🎲    | `/join-game`, `/view-game`, `/list-games`, `/switch-game`                                             |
| Characters          | 🧙    | `/create-character`, `/view-character`, `/list-characters`, `/switch-character`, `/restore-character` |
| Roleplay            | 🎭    | `/ic`, `/ooc`, `/ic-edit`, `/ic-delete`, context menu actions                                         |
| Inventory           | 🎒    | `/inventory`                                                                                          |
| Dice                | 🎯    | `/roll`                                                                                               |
| Voice Transcription | 🎤    | `/transcribe` (start/stop)                                                                            |
| Subscription        | ⭐    | `/subscribe`, `/support`                                                                              |

**GM categories:**

| Category            | Emoji | Commands                                                                       |
| ------------------- | ----- | ------------------------------------------------------------------------------ |
| Getting Started     | 🚀    | Guided walkthrough (create game → define stats → publish → manage flow)        |
| Game Management     | 🎲    | `/create-game`, `/view-game`, `/list-games`, `/switch-game`                    |
| Characters          | 🧙    | All player commands + visibility into public characters, stat template context |
| Roleplay            | 🎭    | Same as player                                                                 |
| Inventory           | 🎒    | Same as player                                                                 |
| Dice                | 🎯    | `/roll`                                                                        |
| Voice Transcription | 🎤    | `/transcribe`                                                                  |
| Server Tools        | ⚙️    | `/bot-announcements`, `/bump-thread`, `/admin`                                 |
| Subscription        | ⭐    | `/subscribe`, `/support`                                                       |

### Step 3: Category Detail

Selecting a category updates the embed with that category's commands. Each command gets:

- The command name (as a Discord slash command mention if possible, plain text if not)
- A one-line description of what it does in plain language
- Any important notes (e.g. "requires a subscription" or "GM only")

No walls of text. 2-4 words per description, followed by a sentence max if needed.

**Example — Player > Characters:**

```
🧙 Characters

/create-character — Start building a new character for your current game.
/view-character — See your active character's full sheet.
/list-characters — Browse public characters in the game.
/switch-character — Change which character is active.
/restore-character — Recover a character you deleted in the last 30 days.
```

**Example — Player > Getting Started:**

```
🚀 Getting Started

Here's how to jump into a game:

1️⃣ **Join a game** — Use /join-game to pick from published games in this server.
2️⃣ **Create a character** — Use /create-character to start a character draft. Fill in the basics, assign stats, and save.
3️⃣ **Play** — Use /ic in an RP channel to post as your character. Use /ooc to switch back to yourself.

That's it! Your GM handles game setup — you just need to join and create a character.
```

The category select menu stays visible so users can browse other categories without starting over.

A "← Back to roles" button lets them switch between Player/GM views.

## Implementation

### New Files

```
src/commands/help.ts                           — slash command definition
src/handlers/help/
  help_role_button.ts                          — player vs GM button handler
  help_category_select.ts                      — category dropdown handler
src/components/help/
  help_landing_card.ts                         — initial role-selection embed + buttons
  help_category_menu.ts                        — role-scoped category select menu builder
  help_category_card.ts                        — category detail embed builder
  help_content.ts                              — all help text content (centralized, easy to edit)
```

### Command Registration

- Register `/help` globally (not guild-scoped)
- Feature gate: `core` (free, everyone can use it)
- Response: ephemeral always (only the user sees their help session)

### Technical Notes

- All responses are ephemeral — help is a private experience
- Use `update` on button/select interactions to edit the original message in-place
- Custom IDs: `help:role:player`, `help:role:gm`, `help:category:<name>`, `help:back`
- Content lives in one file (`help_content.ts`) so updating help text doesn't require touching handlers
- No new persistence — rendering only reads the existing entitlement and gifted-guild sources
- Help itself is always free; its visible categories reflect the server's current access

### Feature Gating Awareness

Help content hides commands the server cannot currently use. It does not show locks, premium badges, or
teasers, so the menu stays useful without becoming an upsell page.

### Context Menu Commands

`Edit IC Message` and `Delete IC Message` are context menu actions (right-click), not slash commands. The Roleplay category should explain how to access these since they're less discoverable.

## Tasks

- [x] 1. Create `help_content.ts` with all help text organized by role and category
- [x] 2. Build the landing card component (role selection embed + buttons)
- [x] 3. Build the category menu component (select menu builder)
- [x] 4. Build the category detail component (category embed builder)
- [x] 5. Implement the `/help` command (sends landing card)
- [x] 6. Implement role button handler (updates to category menu)
- [x] 7. Implement category select handler (updates to category detail)
- [x] 8. Implement "back to roles" button handler
- [x] 9. Register button/select custom IDs in the handler index
- [x] 10. Tests for all components and handlers
- [x] 11. Add `/help` to command policy as `core`

## Resolved Questions

- [x] **Subscription-aware help?** Yes. Hide commands the user's tier doesn't grant access to. No ⭐ badges, no lock icons, no teasers. If you can't use it, you don't see it. This keeps the help menu clean and avoids advertising features users can't purchase yet (e.g. Pro tier transcription before Pro exists in Discord's SKU system).
- [x] **Transcription visibility?** Voice Transcription category is only shown to users with `pro:transcription` access. Since Pro tier doesn't exist as a purchasable plan yet, this effectively hides it from everyone. When Pro launches, it appears automatically.

## Additional Resolved Questions

- [x] **External docs?** Keep the first version fully self-contained in Discord. The guided flow is
      short enough that external links would add friction rather than clarity.
- [x] **`/help <topic>` shortcut?** Not initially. Preserve the simple, two-tap role-first flow and
      add shortcuts later only if usage shows a need.

## Dependencies

- The tier-awareness logic should use the existing `getEntitlementsFor` service to check the guild's feature set. Help content filtering happens at render time — categories with zero visible commands are hidden entirely.
- Pro tier scaffolding (SKU mapping in `plans.ts`, tier-level abstraction for display names) is tracked in `pro-tier-transcription.md`. The help command doesn't need Pro to ship — it just won't show the transcription category until Pro features are granted.
