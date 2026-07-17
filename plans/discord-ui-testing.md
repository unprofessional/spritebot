# Plan: Automated Discord UI Testing

> **Status:** TODO
> **Depends on:** `ux-bdd-stories.md` (test cases derived from BDD stories)

## Problem

Unit and integration tests verify that handlers call the right responder methods (`update` vs `followUp`, `reply` vs `editReply`). But they can't verify what the Discord client actually renders. The help command's ephemeral message spawning bug passed all 431 tests — only a real browser interaction caught it.

Bots can't interact with their own UI components through the Discord API. The only way to test the actual user experience is to drive a real Discord client.

## Approach

Use OpenClaw's browser automation (Chromium) to drive Discord's web client as a test user. The existing Chromium browser session used for X/Twitter link rendering belongs to the Hermes agent (Seb's runtime), not Moldy's. The UI test harness needs its own dedicated browser profile rather than sharing Seb's session.

### Architecture

```
Test Runner (Node.js / Jest)
  ↓
OpenClaw Browser Control API (dedicated test profile)
  ↓
Chromium (logged into Discord as test user)
  ↓
Discord Web Client
  ↓
SPRITE bot (responding to real interactions)
```

### Test Flow

1. Navigate to a designated test channel in the support server
2. Type a slash command (e.g. `/help`)
3. Wait for the bot's ephemeral response
4. Take a snapshot / inspect DOM for expected elements
5. Click buttons or select menu options
6. Assert the message updated in-place (no new message appeared)
7. Assert embed content matches expected text

### Key Assertions

The browser harness can verify things unit tests cannot:

- **In-place updates:** Message count in the channel doesn't increase after a component interaction
- **Ephemeral visibility:** Only the test user sees the response
- **Embed rendering:** Title, description, and field content render correctly
- **Component state:** Select menu shows correct default, buttons are present with correct labels
- **Modal flows:** Modals open with correct fields and prefilled values
- **Error states:** Permission denied messages appear for unauthorized actions

## Infrastructure

### Test User

- Dedicated Discord account for automated testing (not mads's account, not the bot)
- Member of the support server with known roles/permissions
- Logged into the Chromium browser session
- No 2FA complications (or session kept alive)

### Test Channel

- Dedicated `#automated-testing` channel in the support server
- Bot has full permissions
- Test user has standard member permissions
- No other users posting during test runs

### Browser Session

- Dedicated Chromium profile for SPRITE UI testing (not Seb/Hermes's existing session)
- Logged in as the test Discord account
- Must handle Discord's SPA nature (no full page reloads between interactions)
- Runs on yharnam via OpenClaw browser control API

## Implementation

### Phase 1: Harness Foundation

- [ ] Create test user Discord account
- [ ] Set up persistent browser session logged into Discord
- [ ] Create `#automated-testing` channel in support server
- [ ] Build a thin test helper layer over OpenClaw's browser API:
  - `typeSlashCommand(command, options?)` — types and submits a slash command
  - `waitForBotResponse(timeout?)` — waits for the bot's embed to appear
  - `clickButton(label)` — clicks a button by label text
  - `selectOption(placeholder, value)` — selects from a dropdown
  - `getEmbedContent()` — extracts embed title, description, fields
  - `getMessageCount()` — counts messages to detect unwanted new messages
  - `snapshotState()` — captures current UI state for comparison

### Phase 2: Core Smoke Tests

Derived from `ux-bdd-stories.md`:

- [ ] `/help` → role selection → category browsing (in-place update chain)
- [ ] `/roll dice:2d20` → visible result
- [ ] `/view-game` → game card renders with expected buttons
- [ ] `/list-games` → game list renders

### Phase 3: Component Interaction Tests

- [ ] Button clicks update in-place (not new messages)
- [ ] Select menu selections update in-place
- [ ] Cancel/back navigation returns to previous state
- [ ] Confirmation flows (delete → confirm → result)

### Phase 4: Premium/Access Tests

- [ ] Free-tier user sees limited help categories
- [ ] Premium user sees full help categories
- [ ] Gated commands show appropriate access denied messages

### Phase 5: CI Integration

- [ ] Tests run on-demand (not every CI build — too slow/fragile)
- [ ] Triggered manually or on release branches
- [ ] Results reported to a test-results channel or Plane
- [ ] Screenshot capture on failure for debugging

## Risks & Mitigations

| Risk                                  | Mitigation                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Discord UI changes break selectors    | Use aria/role-based refs (OpenClaw snapshot `refs="aria"`), not CSS classes |
| Rate limiting from rapid interactions | Add delays between interactions, limit test concurrency                     |
| Browser session expires               | Implement session health check and re-login flow                            |
| Flaky due to network/render timing    | Retry with backoff on assertion failures, generous timeouts                 |
| Test channel pollution                | Clean up test messages before/after each run                                |
| Discord ToS concerns                  | Use a dedicated bot-testing account, keep interaction volume reasonable     |

## Open Questions

- [ ] Dedicated test Discord account or use an existing alt?
- [ ] Run tests against the production bot or a separate test instance?
- [ ] How to handle ephemeral messages in assertions (they're only visible to the acting user)?
- [ ] Should test runs be gated behind a manual trigger, or automated on release branches?
- [ ] Node.js test runner (Jest? Playwright? Custom?) — or pure OpenClaw browser API scripts?
