# Expired Discord Interaction Crash Hotfix Implementation Plan

> **Status:** Complete — shipped as prerequisite for discord-boundary-reliability.
>
> **For Codex:** Implement this plan task-by-task using strict TDD. Keep the hotfix narrow; do not refactor unrelated command handlers.

**Goal:** Prevent an expired Discord interaction from terminating SPRITEbot, and make gifted guild authorization avoid the slow Discord entitlement fetch that triggered the 2026-07-15 production crash.

**Architecture:** Add a small, non-throwing interaction fallback utility at the Discord boundary, then ensure the detached interaction task has a terminal rejection handler. Reorder the existing gifted-guild authorization check ahead of remote entitlement resolution so gifted servers stay on the local PostgreSQL path. Preserve paid entitlement behavior for non-gifted guilds.

**Tech Stack:** Node.js 22, TypeScript, discord.js v14, Jest, PostgreSQL/PGlite.

---

## Incident and Root Cause

Production evidence from `spritebot-blue` on 2026-07-15 at approximately 22:54 ET:

1. `/create-character` entered `guardCommand()`.
2. The entitlement cache was empty, so `getEntitlementsFor()` called Discord's entitlement API.
3. Authorization eventually succeeded through `GiftedGuildsDAO.isGifted()`, but the guard took about five seconds.
4. `create-character.ts` attempted its first `interaction.reply()` after Discord's three-second initial-response deadline and received `DiscordAPIError[10062]: Unknown interaction`.
5. `initial_commands.ts` caught that command error and called `safeFallback()`.
6. `safeFallback()` attempted another reply against the same expired interaction. That rejection escaped the detached `void (async () => { ... })()` task.
7. Node terminated; Docker's `restart: unless-stopped` policy restarted the container. Docker recorded one restart. There was no host reboot, OOM kill, deployment, or manual restart.

The hotfix must address both proven causes:

- **Crash cause:** a best-effort error response can reject outside the current catch boundary.
- **Trigger on the affected server:** gifted authorization unnecessarily waits for remote entitlement resolution before checking the local gifted-guild grant.

## Scope

### In scope

- Make error/drain fallback responses best-effort and non-throwing.
- Add a final `.catch(...)` to the detached interaction task so no interaction-path rejection becomes an unhandled rejection.
- Check an active gifted-guild grant before calling `getEntitlementsFor()`.
- Add focused regression tests for the exact double-`10062` failure and gifted short-circuit behavior.
- Run unit tests, the full test suite, lint, and build.

### Out of scope

- Migrating every command/component to an automatic `deferReply()`/`editReply()` response abstraction.
- Changing Discord's three-second acknowledgement contract.
- Changing subscription plans, gifted-guild semantics, or entitlement cache schema.
- Suppressing the original command error. The first failure must remain visible in logs.

A later reliability change may introduce deadline-aware deferral across all command and component handlers. Do not bundle that broad migration into this production hotfix. For a non-gifted guild with a slow remote entitlement lookup, an individual interaction may still expire, but it must not crash the process.

### Durable follow-up

Implement the central interaction-contract, timeout, retry-policy, error-classification, redaction, migration, and CI-enforcement architecture in [`plans/discord-boundary-reliability.md`](discord-boundary-reliability.md) after this hotfix lands.

---

### Task 1: Add a Non-Throwing Best-Effort Interaction Response Utility

**Objective:** Isolate fallback Discord responses behind a helper that always settles successfully and logs response failures without exposing interaction tokens.

**Files:**

- Create: `src/client/interaction_responses.ts`
- Create: `tests/unit/client/interaction_responses.test.ts`

**Step 1: Write the failing tests**

Cover all of these cases:

1. A fresh repliable interaction calls `reply()` with the supplied payload.
2. A replied/deferred interaction calls `followUp()`.
3. A non-repliable interaction performs no response call.
4. `reply()` rejecting with a Discord-shaped error `{ code: 10062, status: 404 }` does not reject the helper.
5. `followUp()` rejecting does not reject the helper.
6. A rejected response emits one concise warning containing the operation (`reply` or `followUp`), interaction type when available, error code/status, and no interaction token or request URL.

Use structural mocks rather than constructing discord.js interaction classes. The test should prove the exact production failure is swallowed at the fallback boundary:

```ts
const expired = Object.assign(new Error('Unknown interaction'), {
  code: 10062,
  status: 404,
});
const interaction = {
  type: 2,
  isRepliable: () => true,
  replied: false,
  deferred: false,
  reply: jest.fn().mockRejectedValue(expired),
  followUp: jest.fn(),
};

await expect(bestEffortInteractionResponse(interaction as never, payload)).resolves.toBeUndefined();
expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('code=10062'));
```

**Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- --runTestsByPath tests/unit/client/interaction_responses.test.ts
```

Expected: FAIL because `src/client/interaction_responses.ts` does not exist.

**Step 3: Implement the minimal utility**

Export a helper with this contract:

```ts
export async function bestEffortInteractionResponse(
  interaction: BaseInteraction,
  payload: InteractionReplyOptions,
  context: string,
): Promise<void>;
```

Requirements:

- Return immediately when `interaction.isRepliable()` is false.
- Use `followUp(payload)` when `interaction.replied || interaction.deferred`; otherwise use `reply(payload)`.
- Wrap the selected Discord call in `try/catch`.
- Log a concise warning such as:

```text
[interaction-response] fallback failed context=error-fallback operation=reply type=2 code=10062 status=404
```

- Do not log the full error object because discord.js errors can include the interaction callback URL/token.
- Normalize unknown errors safely. Code/status may be absent.
- Never rethrow from this utility.

Keep payload creation outside the utility; it should only choose the Discord response method and contain failures.

**Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- --runTestsByPath tests/unit/client/interaction_responses.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/client/interaction_responses.ts tests/unit/client/interaction_responses.test.ts
git commit -m "Add safe interaction fallback responses"
```

---

### Task 2: Contain Every Interaction-Task Rejection

**Objective:** Use the non-throwing fallback for normal errors and drain responses, and add a terminal rejection handler to the detached interaction task.

**Files:**

- Modify: `src/client/initial_commands.ts:149-167`
- Modify: `src/client/initial_commands.ts:206-265`
- Modify: `tests/e2e/commands/command-registration.e2e.test.ts`

**Step 1: Write failing regression tests**

Extend the interaction-listener tests with two cases.

**Case A: exact production double failure**

- Register `initializeCommands()` on a fake client.
- Insert a fake chat-input command into `client.commands` whose `execute()` rejects with a Discord-shaped `10062` error.
- Mock `guardCommand()` to return `true` if module mocking is needed to isolate the listener.
- Make the interaction's fallback `reply()` also reject with `10062`.
- Invoke the registered `Events.InteractionCreate` listener.
- Flush the detached promise chain.
- Assert that the fallback was attempted, the failure was logged in redacted form, and no `unhandledRejection` event was observed.

Prefer testing an exported small interaction-dispatch function if the current event-listener closure makes the test nondeterministic. It is acceptable to extract the closure body as:

```ts
export async function dispatchInteraction(
  client: Client,
  interaction: BaseInteraction,
): Promise<void>;
```

Keep `initializeCommands()` responsible for registering:

```ts
client.on(Events.InteractionCreate, (interaction) => {
  void dispatchInteraction(client, interaction).catch((err) => {
    logTerminalInteractionFailure(interaction, err);
  });
});
```

The terminal logger must be redacted and must not throw.

**Case B: drain response failure**

- Call `beginDrain('test')`.
- Supply a repliable interaction whose `reply()` rejects.
- Assert the dispatch/listener settles without an unhandled rejection and logs one redacted warning.

Retain the existing successful drain-response test.

**Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- --runTestsByPath tests/e2e/commands/command-registration.e2e.test.ts
```

Expected: at least one new regression test fails because fallback/drain response rejection currently escapes.

**Step 3: Replace throwing fallbacks**

In `src/client/initial_commands.ts`:

- Import `bestEffortInteractionResponse()`.
- Keep the existing user-facing payloads unchanged.
- Replace the direct response calls in `safeFallback()` and `drainFallback()` with the helper.
- Pass distinct contexts (`error-fallback`, `drain-fallback`) for diagnostics.
- Do not print the full `DiscordAPIError` in the terminal catch. Log only name/message/code/status and interaction type/command/custom ID metadata; never log the callback URL or token.

The existing line:

```ts
console.error('❌ Interaction error:', err);
```

must be replaced with a redacted error logger for the same credential-safety reason. The log must still identify `DiscordAPIError`, code `10062`, status `404`, and the affected command (`create-character`) when available.

**Step 4: Add the terminal promise catch**

Do not leave a bare detached promise:

```ts
void (async () => {
  // ...
})();
```

Attach a final `.catch(...)` or route through an exported async dispatcher and catch its returned promise at registration. The terminal catch is defense in depth: it should log redacted metadata and return without throwing.

Avoid duplicate fallback attempts in the terminal catch. User messaging belongs in the inner command error handler; the terminal catch exists only to contain an unexpected bug in that handler.

**Step 5: Run focused tests and verify GREEN**

Run:

```bash
npm test -- --runTestsByPath \
  tests/unit/client/interaction_responses.test.ts \
  tests/e2e/commands/command-registration.e2e.test.ts
```

Expected: PASS, with no process-level `unhandledRejection` observed by the tests.

**Step 6: Commit**

```bash
git add src/client/initial_commands.ts tests/e2e/commands/command-registration.e2e.test.ts
git commit -m "Contain expired interaction response failures"
```

---

### Task 3: Short-Circuit Gifted Guild Authorization Before Discord API Access

**Objective:** Resolve active gifted guilds through the local database before attempting a remote entitlement lookup.

**Files:**

- Modify: `src/access/authorize.ts:52-94`
- Create: `tests/unit/access/authorize.test.ts`

**Step 1: Write failing authorization-order tests**

Mock `GiftedGuildsDAO.isGifted()` and `getEntitlementsFor()` before importing `authorize.ts`. Reset modules between cases because `authorize.ts` creates its DAO at module scope.

Cover:

1. **Gifted guild:** `isGifted()` resolves `true`; authorization returns `{ ok: true, planName: 'Gifted' }`; `getEntitlementsFor()` is not called.
2. **Non-gifted paid guild:** `isGifted()` resolves `false`; entitlement result includes the required feature; authorization succeeds with the entitlement plan.
3. **Non-gifted core-only guild:** `isGifted()` resolves `false`; entitlement result lacks the required premium feature; authorization returns the existing denial result.
4. **Gift lookup error:** if the local gifted lookup rejects, log a warning and continue to normal entitlement resolution rather than failing closed solely because the optimization errored.

The first test is the key regression assertion:

```ts
expect(mockIsGifted).toHaveBeenCalledWith('guild-1');
expect(mockGetEntitlementsFor).not.toHaveBeenCalled();
```

**Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- --runTestsByPath tests/unit/access/authorize.test.ts
```

Expected: gifted short-circuit test FAILS because the current code calls `getEntitlementsFor()` first.

**Step 3: Reorder authorization without changing semantics**

After guild/owner/admin bypasses and before `getEntitlementsFor()`:

1. Query `giftedDAO.isGifted(guildId)`.
2. Return Gifted access immediately when true.
3. If the query throws, emit a concise warning and continue to entitlement resolution.
4. Remove the later duplicate gifted lookup.

Do not run gifted and entitlement checks in parallel; the purpose is to avoid the remote call entirely for gifted guilds.

Do not change paid/core feature calculations or denial messages.

**Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- --runTestsByPath tests/unit/access/authorize.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/access/authorize.ts tests/unit/access/authorize.test.ts
git commit -m "Check gifted access before remote entitlements"
```

---

### Task 4: Verify the Complete Hotfix

**Objective:** Prove the hotfix is formatted, type-safe, regression-tested, and buildable before deployment.

**Files:**

- Modify only files required to resolve failures introduced by Tasks 1-3.

**Step 1: Format touched files**

Run:

```bash
npx prettier --write \
  src/client/interaction_responses.ts \
  src/client/initial_commands.ts \
  src/access/authorize.ts \
  tests/unit/client/interaction_responses.test.ts \
  tests/e2e/commands/command-registration.e2e.test.ts \
  tests/unit/access/authorize.test.ts
```

Expected: command exits 0.

**Step 2: Run focused regression tests**

Run:

```bash
npm test -- --runTestsByPath \
  tests/unit/client/interaction_responses.test.ts \
  tests/e2e/commands/command-registration.e2e.test.ts \
  tests/unit/access/authorize.test.ts
```

Expected: all focused tests PASS.

**Step 3: Run all quality gates**

Run each command separately so a failure is attributable:

```bash
npm run lint
npm test
npm run build
```

Expected: all commands exit 0.

**Step 4: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat develop...HEAD
git diff develop...HEAD
```

Verify:

- No interaction token, callback URL, bot token, or environment secret is logged or committed.
- No broad `reply()` migration or unrelated refactor entered the hotfix.
- The original interaction error remains diagnosable in redacted logs.
- Fallback response errors cannot reject out of their helper.
- The interaction listener has a terminal rejection handler.
- Gifted guilds do not call the Discord entitlement API.

**Step 5: Commit any test-only adjustments**

If Task 4 required legitimate adjustments:

```bash
git add <exact-files>
git commit -m "Test expired interaction crash hotfix"
```

Do not create an empty commit.

---

## Acceptance Criteria

- Replaying the production shape—command response rejects with `10062`, then fallback response also rejects with `10062`—does not emit an unhandled rejection and does not terminate the test process.
- A failed drain response is also contained.
- Error logs include safe diagnostics (`context`, interaction kind/command, error name/message, code, status) but omit callback URLs and interaction tokens.
- An active gifted guild is authorized using only the local gifted-guild query; `getEntitlementsFor()` is not invoked.
- Non-gifted paid/core authorization behavior remains unchanged.
- Existing user-facing fallback and drain messages remain unchanged.
- Focused tests, `npm run lint`, `npm test`, and `npm run build` all pass.

## Deployment Verification

After merge/deployment, verify on `shinralabs` without intentionally crashing production:

```bash
docker inspect spritebot-blue --format 'RestartCount={{.RestartCount}} Started={{.State.StartedAt}} Status={{.State.Status}}'
docker logs --timestamps --since 10m spritebot-blue 2>&1
```

Then invoke `/create-character` in the known gifted test guild and confirm:

1. Logs show the gifted lookup before any entitlement API fetch.
2. Logs show `Gifted access granted`.
3. That interaction does not log `Cache miss → fetching entitlements from Discord API`.
4. The command responds successfully.
5. The container restart count does not increase during the verification window.

If an interaction is deliberately mocked to expire in a non-production test environment, expect a redacted `code=10062 status=404` warning and a still-running process.
