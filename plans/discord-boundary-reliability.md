# Discord Boundary Reliability Implementation Plan

> **For Codex:** Use TDD and implement this plan in phased pull requests. Do not combine the migration into one release. The expired-interaction hotfix must land first.

**Goal:** Establish one durable boundary for Discord interaction contracts and outbound Discord API behavior so slow, expired, rate-limited, or failed Discord calls cannot silently violate acknowledgement deadlines or crash SPRITEbot.

**Architecture:** Split the boundary into two cooperating modules. An interaction responder owns Discord's one-time acknowledgement state machine (`reply`, `deferReply`, `editReply`, `followUp`, `deferUpdate`, `update`, and `showModal`). A general Discord operation executor owns time budgets, error classification, safe retry policy, redacted telemetry, and cancellation for outbound reads and writes. Migrate call sites incrementally, then enforce the boundary with a repository check.

**Tech Stack:** Node.js 22, TypeScript, discord.js v14, Jest fake timers, native `AbortController`/`AbortSignal`, ESLint/TypeScript compiler tooling, PostgreSQL/PGlite where existing integration tests require it.

**Prerequisite:** Complete `plans/hotfix-interaction-expiry-crash.md`. That hotfix contains the immediate process-crash guard and gifted-guild short circuit. This plan replaces scattered response behavior with the durable architecture; it must preserve the hotfix's non-throwing terminal containment.

---

## Problem Statement

The 2026-07-15 `/create-character` incident exposed two separate boundary failures:

1. A cache miss caused authorization to wait synchronously on Discord's entitlement API before the interaction was acknowledged.
2. After Discord invalidated the interaction, both the command reply and fallback reply failed with `10062 Unknown interaction`; the fallback rejection escaped a detached promise and terminated Node.

The repository currently calls Discord interaction methods directly throughout commands, components, and handlers. There are also direct SDK and raw HTTP operations for entitlement reads, command registration, channel/message operations, webhooks, lifecycle notifications, roleplay proxying, thread bumps, support verification, and voice transcription. A local fix at one command does not protect the next call site.

This plan treats Discord as an external distributed-system boundary with explicit contracts.

## Design Principles

1. **Acknowledge first.** Any interaction path that may perform I/O must acknowledge within a configurable budget below Discord's three-second deadline.
2. **One owner of response state.** Business handlers must not decide independently whether to call `reply`, `editReply`, or `followUp`.
3. **No callback retries.** Never retry `reply`, `deferReply`, `editReply`, `followUp`, `update`, `deferUpdate`, or `showModal` after Discord reports an expired or already-acknowledged interaction.
4. **Retries are opt-in.** Retry only operations explicitly classified as safe and idempotent. Do not infer safety from HTTP method alone.
5. **Bound every external wait.** Raw HTTP and selected SDK reads need explicit time budgets and cancellation where the underlying API supports it.
6. **Respect discord.js.** discord.js already coordinates Discord rate-limit buckets. The boundary may classify and observe rate limits, but must not create a competing global rate-limit scheduler.
7. **Redact by construction.** Never log bot tokens, interaction tokens, authorization headers, callback URLs, webhook credentials, or raw Discord error request URLs.
8. **Containment remains mandatory.** Boundary failures return typed outcomes or throw typed errors to a caught dispatcher; no detached promise may reject without a terminal catch.
9. **Migrate incrementally.** Each phase must be independently testable, reviewable, and deployable.

## Non-Goals

- Replacing discord.js REST bucket/rate-limit management.
- Automatically retrying message creation, webhook sends, command callbacks, or other non-idempotent writes.
- Hiding authorization or permission failures behind generic retries.
- Changing product entitlement semantics.
- Adding a general-purpose HTTP framework.
- Refactoring unrelated business services during call-site migration.

---

## Target Modules

Create a dedicated boundary directory:

```text
src/discord/
  errors.ts                 # typed classification and safe metadata
  logging.ts                # structured redacted event formatting
  operation_policy.ts       # timeout/retry policy types and defaults
  operation_executor.ts     # bounded outbound operation execution
  interaction_responder.ts  # interaction acknowledgement/response state machine
  interaction_dispatch.ts   # dispatcher integration and terminal containment
  index.ts                  # supported public exports
```

Tests mirror this structure under `tests/unit/discord/`. Integration/contract tests live under `tests/integration/discord/`.

Only files under `src/discord/` and a short explicit bootstrap allowlist may directly call controlled Discord boundary methods after migration.

## Agreed Delivery Grouping

The task numbers describe implementation order, not one PR per task. Use these review units:

1. **Inventory/enforcement scaffold:** Task 1 introduces the repository-local ESLint rule in warning/report mode and records the migration matrix.
2. **Boundary foundation PR:** Tasks 2 and 3 ship together (classification/redaction plus the operation executor) because neither is useful alone.
3. **Interaction dispatcher PR:** Tasks 4 and 5 ship together (responder state machine plus deadline-aware dispatch) and migrate one representative command/component vertical slice so production wiring is exercised immediately.
4. **Migration PRs:** Tasks 6-8 proceed in small subsystem batches. Adjacent command/component batches may share a PR when the diff remains reviewable, but modal-opening routes stay isolated because they often require control-flow redesign.
5. **Enforcement/fault coverage:** Tasks 9 and 10 may share a PR after the migration reaches zero unexplained violations.

This keeps the dependency order while avoiding four review round-trips before the first production call site uses the boundary.

---

### Task 1: Record the Discord Call-Site Inventory and Migration Matrix

**Objective:** Produce a checked-in source-of-truth inventory before designing wrappers around incomplete assumptions.

**Files:**

- Create: `docs/discord-boundary-inventory.md`
- Create: `eslint-rules/discord-boundary.cjs`
- Create: `scripts/report-discord-boundary.cjs`
- Modify: `eslint.config.js`
- Modify: `package.json`
- Test: `tests/unit/eslint-rules/discord-boundary.test.ts`

**Step 1: Write the failing ESLint-rule test**

Use a temporary fixture tree and assert that the rule detects and classifies:

- Interaction contract methods: `reply`, `deferReply`, `editReply`, `followUp`, `showModal`, `update`, and `deferUpdate`.
- Raw HTTP calls to `discord.com/api`.
- discord.js REST route registration (`new REST`, `Routes.*`).
- SDK reads/writes such as channel/message/member fetches, message sends/edits/deletes, webhook sends, and thread/channel changes.
- An allowlisted boundary file without reporting it as a violation.

Implement one focused repository-local ESLint rule using the parser already configured by `eslint.config.js`. The rule must inspect imports, receiver provenance, and member-call AST nodes; do not use regex-only matching that confuses arbitrary domain methods named `send`, `edit`, or `fetch` with Discord operations. The same rule powers both migration inventory and the final CI gate so Task 9 hardens configuration rather than replacing Task 1 tooling.

**Step 2: Run RED**

```bash
npm test -- --runTestsByPath tests/unit/eslint-rules/discord-boundary.test.ts
```

Expected: FAIL because the local ESLint rule does not exist.

**Step 3: Implement report mode**

Add:

```json
"audit:discord-boundary": "node scripts/report-discord-boundary.cjs"
```

Configure the local rule as a warning during migration. The report script invokes ESLint through its Node API, extracts only this rule's findings, and prints file, line, operation family, method, and migration status. Report mode exits 0 while boundary warnings remain, but must preserve a nonzero exit for parser failures or unrelated ESLint errors; ordinary lint failures must still fail `npm run lint`.

**Step 4: Generate and review the inventory**

```bash
npm run audit:discord-boundary > /tmp/discord-boundary-audit.txt
```

Convert the results into `docs/discord-boundary-inventory.md` with these columns:

| Area | Current files | Operation type | Interaction deadline? | Retry-safe? | Planned adapter | Migration phase |
| ---- | ------------- | -------------- | --------------------- | ----------- | --------------- | --------------- |

At minimum inventory:

- `src/client/initial_commands.ts`
- `src/services/discord_entitlements_api.ts`
- `src/services/lifecycle_notification.service.ts`
- `src/services/rp_message_proxy.service.ts`
- `src/services/support_verification.service.ts`
- `src/schedulers/per_thread_bump_manager.ts`
- `src/voice/voice_manager.ts`
- `src/voice/progress_message.ts`
- all `src/commands/*.ts`
- all `src/components/*.ts`
- all `src/handlers/**/*.ts`

Do not rely only on this initial list; the generated inventory is authoritative.

**Step 5: Run GREEN and commit**

```bash
npm test -- --runTestsByPath tests/unit/eslint-rules/discord-boundary.test.ts
npm run audit:discord-boundary
git add docs/discord-boundary-inventory.md eslint-rules/discord-boundary.cjs scripts/report-discord-boundary.cjs eslint.config.js package.json tests/unit/eslint-rules/discord-boundary.test.ts
git commit -m "Inventory Discord boundary call sites"
```

---

### Task 2: Define Typed Discord Error Classification and Redaction

**Objective:** Convert discord.js/raw HTTP failures into safe, actionable categories without leaking credentials.

**Delivery:** Implement and review Tasks 2 and 3 together as the boundary foundation PR. Keep their TDD steps and commits distinct inside that PR.

**Files:**

- Create: `src/discord/errors.ts`
- Create: `src/discord/logging.ts`
- Create: `tests/unit/discord/errors.test.ts`
- Create: `tests/unit/discord/logging.test.ts`

**Step 1: Write failing classifier tests**

Cover:

- `10062` → `interaction_expired`, permanent, never retry.
- `40060` → `interaction_already_acknowledged`, permanent, never retry.
- HTTP `429` → `rate_limited`, retry only when the operation policy explicitly allows it and a safe delay is supplied.
- HTTP `401`/`403` → `authentication_or_permission`, permanent.
- HTTP `404` without `10062` → `not_found`, permanent by default.
- `AbortError`/timeout sentinel → `timeout`.
- connection reset/DNS/headers timeout shapes → `transient_network`.
- unknown errors → `unknown`, no automatic retry.

**Step 2: Write failing redaction tests**

Construct an error containing:

- `https://discord.com/api/v10/interactions/<id>/<token>/callback`
- `Authorization: Bot sample-secret-token`
- a webhook URL/token
- nested `requestBody` and `rawError`

Assert the logged metadata contains operation, category, code, status, attempt, elapsed time, command/custom ID when safe, and none of the secrets or URLs.

**Step 3: Run RED**

```bash
npm test -- --runTestsByPath tests/unit/discord/errors.test.ts tests/unit/discord/logging.test.ts
```

**Step 4: Implement minimal typed results**

Use explicit types, for example:

```ts
export type DiscordErrorCategory =
  | 'interaction_expired'
  | 'interaction_already_acknowledged'
  | 'rate_limited'
  | 'authentication_or_permission'
  | 'not_found'
  | 'timeout'
  | 'transient_network'
  | 'unknown';

export interface ClassifiedDiscordError {
  category: DiscordErrorCategory;
  retryable: boolean;
  code?: number | string;
  status?: number;
  safeMessage: string;
}
```

`retryable` is a property of the observed failure only; the operation executor must also require an opt-in retry policy.

**Step 5: Run GREEN and commit**

```bash
npm test -- --runTestsByPath tests/unit/discord/errors.test.ts tests/unit/discord/logging.test.ts
git add src/discord/errors.ts src/discord/logging.ts tests/unit/discord/errors.test.ts tests/unit/discord/logging.test.ts
git commit -m "Classify and redact Discord failures"
```

---

### Task 3: Build the Bounded Discord Operation Executor

**Objective:** Provide one executor for outbound Discord work with explicit deadlines, cancellation, retry safety, backoff, and telemetry.

**Delivery:** This completes the boundary foundation PR started in Task 2; do not open a second review round-trip for the executor alone.

**Files:**

- Create: `src/discord/operation_policy.ts`
- Create: `src/discord/operation_executor.ts`
- Create: `tests/unit/discord/operation_executor.test.ts`

**Step 1: Write failing fake-timer tests**

Cover:

1. A successful operation returns its value and records one attempt.
2. A hung operation times out at the configured deadline.
3. The executor passes an `AbortSignal` to operations that support cancellation.
4. `interaction_expired` and `interaction_already_acknowledged` are never retried.
5. A transient read retries only when `retry: 'safe-read'` is explicit.
6. A write with `retry: 'never'` is attempted once even after a transient network error.
7. A `429` respects a bounded retry delay only for an explicitly retry-safe operation.
8. Max attempts and total elapsed budget cap all retries.
9. Backoff uses injected sleep/random dependencies so tests are deterministic.
10. Logs/metrics are emitted once per attempt and once for final outcome, using redacted metadata.

**Step 2: Run RED**

```bash
npm test -- --runTestsByPath tests/unit/discord/operation_executor.test.ts
```

**Step 3: Implement policy types**

Require every call site to name its operation and policy:

```ts
export interface DiscordOperationPolicy {
  operation: string;
  timeoutMs: number;
  totalBudgetMs: number;
  retry: 'never' | 'safe-read' | 'idempotent-write';
  maxAttempts: number;
}
```

Defaults must be conservative:

- `retry: 'never'`
- `maxAttempts: 1`
- no unbounded timeout

Do not silently classify writes as idempotent. An `idempotent-write` policy requires a code comment at the call site explaining the idempotency key or invariant.

**Step 4: Implement the executor**

Use a promise factory:

```ts
executeDiscordOperation(policy, ({ signal, attempt }) => operation(signal, attempt));
```

The executor must:

- create/clear timeout resources correctly;
- abort raw HTTP requests when possible;
- ignore late settlement after timeout without producing an unhandled rejection;
- classify errors through `errors.ts`;
- ask both the error classifier and operation policy before retrying;
- return/throw a typed final result that callers can handle;
- never retry Discord interaction callback methods.

**Step 5: Run GREEN and commit**

```bash
npm test -- --runTestsByPath tests/unit/discord/operation_executor.test.ts
git add src/discord/operation_policy.ts src/discord/operation_executor.ts tests/unit/discord/operation_executor.test.ts
git commit -m "Add bounded Discord operation executor"
```

---

### Task 4: Build the Interaction Responder State Machine

**Objective:** Make acknowledgement and subsequent response method selection deterministic and testable.

**Delivery:** Implement and review Tasks 4 and 5 together as the interaction dispatcher PR. Keep their TDD steps and commits distinct, and include one representative production command/component migration in Task 5.

**Files:**

- Create: `src/discord/interaction_responder.ts`
- Create: `tests/unit/discord/interaction_responder.test.ts`

**Step 1: Write failing contract tests**

Cover these states and transitions:

- `unacknowledged` + immediate response → `reply`.
- `unacknowledged` + deferred response policy → `deferReply` before business work.
- `deferred_reply` + first content → `editReply`.
- `replied` + additional content → `followUp`.
- Component update path → `deferUpdate`/`update` according to policy.
- Modal path → `showModal` as the initial acknowledgement; it must never be preceded by `deferReply` or `deferUpdate`.
- `10062` marks the session expired and suppresses all further callback attempts.
- `40060` reconciles local state with `interaction.replied`/`interaction.deferred`, logs once, and does not retry.
- Concurrent response attempts serialize so only one wins the initial acknowledgement.
- Public/ephemeral intent is fixed before deferral; a deferred ephemeral response cannot later become public.

**Step 2: Run RED**

```bash
npm test -- --runTestsByPath tests/unit/discord/interaction_responder.test.ts
```

**Step 3: Implement explicit response modes**

Do not use a single ambiguous boolean. Support modes such as:

```ts
type InteractionMode =
  | { kind: 'reply'; visibility: 'ephemeral' | 'public' }
  | { kind: 'component-update' }
  | { kind: 'modal' }
  | { kind: 'modal-or-reply'; visibility: 'ephemeral' | 'public' };
```

Expose narrow methods rather than the raw interaction:

```ts
responder.acknowledge();
responder.respond(payload);
responder.followUp(payload);
responder.showModal(modal);
```

`respond()` selects `reply` versus `editReply` from owned state. No caller may retry an expired callback.

**Step 4: Preserve hotfix containment**

Integrate or absorb the hotfix's best-effort fallback helper. There must be one final implementation, not two competing response abstractions. Keep the terminal dispatcher catch even after the state machine is adopted.

**Step 5: Run GREEN and commit**

```bash
npm test -- --runTestsByPath tests/unit/discord/interaction_responder.test.ts
git add src/discord/interaction_responder.ts tests/unit/discord/interaction_responder.test.ts
git commit -m "Add Discord interaction response state machine"
```

---

### Task 5: Add Deadline-Aware Interaction Dispatch

**Objective:** Ensure potentially slow interaction paths acknowledge before Discord's deadline while preserving modal-first paths.

**Delivery:** This completes the interaction dispatcher PR started in Task 4. The PR is not complete until at least one real command/component path runs through the responder and dispatcher integration tests.

**Files:**

- Create: `src/discord/interaction_dispatch.ts`
- Modify: `src/client/initial_commands.ts`
- Modify: `src/access/guards.ts`
- Create: `tests/integration/discord/interaction_dispatch.test.ts`

**Step 1: Write failing dispatch tests**

Use fake timers and deferred promises to prove:

1. A slow command guard is deferred before the configured acknowledgement budget.
2. After guard success, the command's first response edits the deferred reply.
3. Guard denial edits the deferred reply with the existing user-facing denial.
4. Fast commands may reply immediately without unnecessary deferral if the selected policy permits it.
5. A modal-first component is never auto-deferred; it must show the modal within budget.
6. A modal-first handler that misses its budget produces a typed deadline failure and no second callback attempt.
7. Every dispatch promise has a terminal catch and participates in `trackOperation()`/drain behavior.

Set the acknowledgement budget below three seconds with margin (for example 1,500-2,000 ms), but define it in one config location and inject the clock in tests. Do not scatter magic numbers.

**Step 2: Run RED**

```bash
npm test -- --runTestsByPath tests/integration/discord/interaction_dispatch.test.ts
```

**Step 3: Define handler response policy**

Add explicit metadata for each interaction entry point:

- commands/context commands: reply mode and visibility;
- components that edit an existing message: component-update mode;
- components that open modals: modal mode;
- handlers with mixed behavior must be split or choose the mode before any I/O.

Authorization must execute inside the dispatch budget, not before responder creation.

**Step 4: Integrate the dispatcher**

`src/client/initial_commands.ts` should register one small listener that creates a responder, dispatches through the selected policy, and catches terminal failures. Remove duplicated reply/follow-up selection from this file after migration.

**Step 5: Run GREEN and commit**

```bash
npm test -- --runTestsByPath tests/integration/discord/interaction_dispatch.test.ts tests/e2e/commands/command-registration.e2e.test.ts
git add src/discord/interaction_dispatch.ts src/client/initial_commands.ts src/access/guards.ts tests/integration/discord/interaction_dispatch.test.ts tests/e2e/commands/command-registration.e2e.test.ts
git commit -m "Acknowledge interactions through a deadline-aware dispatcher"
```

---

### Task 6: Migrate Commands in Small Batches

**Objective:** Remove direct interaction response decisions from slash/context commands without changing user-visible behavior.

**Files:**

- Modify: files identified under `src/commands/` by the inventory.
- Modify/Create: matching tests under `tests/integration/commands/` and `tests/e2e/commands/`.
- Update: `docs/discord-boundary-inventory.md` after each batch.

**Step 1: Group commands by response contract**

Use separate commits/PRs for:

1. Read-only/core commands.
2. Character/game mutation commands.
3. Inventory/RP commands.
4. Admin/support/subscription commands.
5. Voice transcription commands.

Do not migrate all commands in one commit.

**Step 2: Add a regression test before each batch**

For every command in the batch, assert:

- original content/components/embeds and visibility are preserved;
- a pre-deferred command uses `editReply`, not `reply`;
- later progress/results use `followUp` only where intended;
- expired responders stop cleanly.

**Step 3: Replace raw interaction response calls**

Pass a responder/context into command execution. Commands may read safe interaction data (user, guild, options) but must use the responder for acknowledgement and messages.

Do not perform mechanical `reply` → `editReply` replacement. The responder owns state selection.

**Step 4: Run batch tests and quality gates**

```bash
npm test -- --runTestsByPath <batch-test-files>
npm run lint
npm run build
```

**Step 5: Commit each batch**

Use one descriptive commit per batch, for example:

```bash
git commit -m "Migrate core commands to Discord responder"
```

---

### Task 7: Migrate Components, Select Menus, and Modals

**Objective:** Enforce correct acknowledgement semantics for component updates and modal-opening interactions.

**Files:**

- Modify: inventoried files under `src/components/`.
- Modify: inventoried files under `src/handlers/button_handlers/`, `src/handlers/select_menu_handlers/`, and `src/handlers/modal_handlers/`.
- Create/Modify: matching tests under `tests/integration/components/` and `tests/integration/handlers/`.
- Update: `docs/discord-boundary-inventory.md`.

**Completed: Batch 1 (simple components)**

17 button/selector components migrated to the responder in commit `05ea316`. The dispatcher in `initial_commands.ts` now routes buttons and selects through `startTrackedInteractionDispatch` when the component exports an `interactionPolicy`. Handler indexes pass the responder through.

**Responder design note (from batch 1 review):** Many components have mixed response patterns — `update()` for success, `reply({ ephemeral: true })` for errors. After `deferUpdate()`, `editReply()` would overwrite the original message with the error. The responder now handles this: when `respond()` is called with `ephemeral: true` in `component-update` mode, it routes to `followUp({ ephemeral: true })` instead, leaving the original message intact and sending a private error to the user. `followUp()` also preserves ephemeral in component-update mode. **All future component migrations should use `responder.respond({ ..., ephemeral: true })` for error paths — the responder does the right thing automatically.**

**Prepared-modal design note:** Prefilled editors must preserve their existing values. Use
`modal-or-reply` mode with `presentPreparedModal()`: preparation that completes inside the
acknowledgement budget opens the prefilled modal immediately; if the dispatcher has already
deferred ephemerally, the prepared modal is retained behind a short-lived, owner-bound opaque
token and an **Open editor** button. Modal data must never be encoded in `customId`. A slow path may
add one activation click, but it must never replace a prefilled editor with a blank modal. Prepared
state is process-local and bounded; activation after a restart returns explicit retry guidance.
Prepared-modal activation uses manual acknowledgement because opening the modal consumes the button
interaction's initial response; auto-defer would compete with the only successful response path.
Token lookup and expired-token feedback must remain process-local and immediately available.

**Completed: Batch 2A (synchronous modal-opening selectors)**

`character_field_selector`, `edit_character_field_selector`, and `stat_type_selector` use the
shared manual `modal-or-reply` policy. They build and show their existing modals synchronously, or
send their existing ephemeral validation reply. Their activating component authorization is
deferred to the already-gated modal submission so a remote entitlement lookup cannot consume the
only response that can open the modal.

**Completed: Batch 2B.1 (prepared stat-template editor)**

`edit_stat_selector` uses the shared gated prepared-modal policy. A fast stat-template lookup opens
the existing prefilled editor immediately; a slow lookup preserves the same editor behind the
owner-bound activation button. The modal submission remains the authoritative authorization
boundary. The unrouted `stat_template_dropdown` duplicate was removed after confirming the live
router has always used the dedicated edit and delete selector components.

**Completed: Batch 2B.2 (prepared character field/stat editor)**

`character_stat_select_menu` routes both core-field and game-stat selections through the shared
gated prepared-modal policy. Fast character hydration preserves the immediate prefilled modal;
slow hydration preserves the same values behind owner-bound activation. Existing missing-selection,
missing-character, and missing-stat errors remain ephemeral, and both modal submission prefixes
remain authoritative authorization boundaries.

**Completed: Batch 2B.3 (prepared numeric-stat adjustment editor)**

`adjust_numeric_stat_select` uses a component-update-aware prepared-modal policy. Fast stat
hydration opens the existing adjustment modal immediately, while slow hydration keeps the original
message intact and presents the same modal behind private owner-bound activation. Existing
not-found results continue replacing the original message, including after automatic component
deferral, and the unknown-selection fallback remains an immediate ephemeral reply. The adjustment
modal submission remains the authoritative authorization boundary.

**Completed: Batch 2B.4 (prepared inventory add/edit modals)**

The inventory add and edit buttons use the shared gated prepared-modal policy. Fast ownership and
item lookups preserve the immediate blank add modal and prefilled edit modal, including the
existing immediate ownership denial. Slow lookups preserve the same modal behind owner-bound
activation. Both modal submissions repeat ownership validation and remain the authoritative
inventory-entitlement boundary.

**Completed: Batches 3-4 (remaining components, buttons/selects, and modal submissions)**

All remaining component and handler routes now declare explicit responder policies. Message
replacement actions and message-backed modal submissions use component-update auto-deferral;
read-only inventory view and IC edit submission use ephemeral reply auto-deferral; inventory modal
submissions select between those contracts based on whether Discord supplies a source message.
Every button, select, and modal now enters the deadline-aware dispatcher, including unknown-route
fallbacks. Inventory routing uses one non-overlapping family predicate with per-action policies.

**Task 7 complete. Remaining implementation begins with Task 8 entitlement/authorization work.**

**Step 1: Classify before migration**

Every component route must be one of:

- immediate modal;
- message update;
- deferred component update;
- ephemeral/public reply;
- follow-up only after an existing acknowledgement.

Mixed routes must choose their contract synchronously before database/network work.

**Known modal migration friction:** Inventory every modal-opening route for asynchronous database/API work performed before `showModal()`. These routes cannot be migrated mechanically because Discord does not allow a prior defer followed by `showModal()`. Restructure each affected route using one of these reviewed patterns:

1. Fetch the required values while building the earlier message/component and carry only a safe opaque lookup key into the modal-opening interaction.
2. Add an intermediate loading/setup interaction that performs the I/O, then renders a new button whose next click can show the modal synchronously.
3. Show a minimal modal immediately and perform authoritative lookup/validation on modal submission when prefilled values are not required.
4. For an editor that requires prefetched values, use the prepared-modal boundary so the fast path
   opens immediately and the slow path safely presents an owner-bound activation button.

Do not encode secrets or oversized state in `customId`, and do not use stale prefetched data without revalidation on submission. Record the selected restructuring pattern for each affected route in `docs/discord-boundary-inventory.md`.

**Step 2: Add modal safety tests**

Prove that `showModal()` is the first and only initial acknowledgement. A responder must reject an attempt to show a modal after deferral locally before sending another Discord call.

**Step 3: Add component update tests**

Prove slow component work uses `deferUpdate()` within budget, then edits/updates through the responder without displaying a spurious loading reply.

**Step 4: Migrate in batches and verify**

Use the same RED/GREEN/lint/build cycle as Task 6. Preserve all custom IDs and user-visible copy.

**Step 5: Commit each batch**

Keep modal routes separate from ordinary component-update routes to simplify review.

---

### Task 8: Migrate Raw Discord HTTP and Non-Interaction SDK Operations

**Objective:** Apply explicit operation policies to Discord API work outside the interaction callback state machine.

**Files:**

- Modify: `src/services/discord_entitlements_api.ts`
- Modify: all additional files identified in `docs/discord-boundary-inventory.md`.
- Create/Modify: focused tests alongside each service/scheduler/voice module.

**Step 1: Start with entitlement reads**

Wrap `fetchGuildEntitlementsLazy()` with:

- an explicit two-second total budget for the interactive authorization path after the dispatcher has deferred the interaction;
- `AbortSignal` cancellation for raw `fetch`;
- `safe-read` retry policy whose attempts and backoff fit inside that same two-second total budget;
- typed failure results so authorization can distinguish timeout/transient failure from a confirmed empty entitlement set.

Check local gifted access and trustworthy cached entitlements before the remote request. Never convert a timeout into "no subscription." Preserve stale-good cache data where current semantics allow it. If no trustworthy local result exists and Discord times out or fails transiently, return a distinct `AUTHORIZATION_UNAVAILABLE` outcome, fail closed for the requested action without changing state, and edit the deferred ephemeral reply to exactly:

```text
I couldn’t verify this server’s access with Discord right now. Nothing was changed. Please try again in a moment.
```

Do not show the subscription-upgrade message for this outcome, and never leave the deferred reply hanging.

**Step 2: Test entitlement timeout semantics**

Cover fast success, timeout, transient retry within the two-second total budget, permanent `401/403`, rate limit, stale-cache fallback, no false empty result, the exact `AUTHORIZATION_UNAVAILABLE` user copy, no upgrade CTA, and no hanging deferred reply.

**Step 3: Inventory each remaining operation's policy**

For every Discord SDK/raw REST operation, record:

- timeout;
- retry mode;
- max attempts;
- idempotency explanation if retries are enabled;
- caller behavior on timeout/permanent failure.

Examples:

- command registration `PUT`: idempotent-write candidate with a documented invariant;
- channel/message/member fetches: safe-read candidates;
- message/webhook sends: retry never unless an application idempotency mechanism exists;
- deletes/edits: evaluate individually; do not assume;
- lifecycle notifications: best effort, bounded, no process crash;
- thread bump send: avoid duplicate bumps;
- RP proxy send/delete sequence: preserve ordering and original-message safety;
- voice progress/final transcript publication: preserve partial-result behavior.

**Step 4: Migrate one subsystem per commit**

Recommended order:

1. Entitlements and command registration.
2. Lifecycle/support verification.
3. Thread bump scheduling.
4. RP proxy operations.
5. Voice progress and transcript publication.

Run focused tests plus full quality gates after each subsystem.

---

### Task 9: Enforce the Boundary in CI

**Objective:** Prevent new direct Discord contract/API calls from bypassing the wrapper.

**Files:**

- Modify: `eslint-rules/discord-boundary.cjs`
- Modify: `scripts/report-discord-boundary.cjs`
- Modify: `eslint.config.js`
- Modify: `package.json`
- Modify: `.github/workflows/pr-checks.yml`
- Modify: `Jenkinsfile`
- Modify: `tests/unit/eslint-rules/discord-boundary.test.ts`
- Update: `docs/discord-boundary-inventory.md`

**Step 1: Add failing enforcement tests**

Assert the rule reports a new forbidden direct call with actionable file/line/method metadata. Assert allowlisted boundary/bootstrap files pass and unrelated domain methods with the same names do not produce false positives.

**Step 2: Add check mode**

```json
"check:discord-boundary": "eslint src --quiet"
```

Promote the existing local rule from warning to error in `eslint.config.js`; do not build a second checker. The allowlist must be short and documented in rule options. Do not allow entire commands/components/handlers directories.

**Step 3: Reach zero migration violations**

Run:

```bash
npm run audit:discord-boundary
npm run check:discord-boundary
```

Expected: check exits 0 only after all inventory rows are migrated or explicitly exempted with rationale and expiry owner/date.

**Step 4: Wire CI**

Add `npm run check:discord-boundary` to GitHub PR checks and Jenkins before build/package/deploy.

**Step 5: Commit**

```bash
git add eslint-rules/discord-boundary.cjs scripts/report-discord-boundary.cjs eslint.config.js package.json .github/workflows/pr-checks.yml Jenkinsfile tests/unit/eslint-rules/discord-boundary.test.ts docs/discord-boundary-inventory.md
git commit -m "Enforce Discord boundary usage in CI"
```

---

### Task 10: Add Contract and Fault-Injection Coverage

**Objective:** Verify boundary behavior under timing and failure modes that ordinary happy-path mocks miss.

**Files:**

- Create: `tests/integration/discord/interaction_contract.test.ts`
- Create: `tests/integration/discord/operation_faults.test.ts`
- Modify: `tests/README.md`

**Step 1: Build deterministic fault fixtures**

Fixtures must simulate:

- a response completing just before and just after the acknowledgement budget;
- `10062` on first callback;
- `10062` on fallback;
- `40060` from concurrent acknowledgements;
- delayed success after local timeout;
- connection reset;
- `429` with retry delay;
- permanent `401/403`;
- process drain beginning while an operation is active.

**Step 2: Assert process-level safety**

Capture `unhandledRejection` during each fixture. Every test must leave the listener count and fake timers clean. No scenario may terminate the test worker or leave an unobserved promise.

**Step 3: Assert duplicate prevention**

For non-idempotent operations, prove only one send/write attempt occurs despite transient failures. For retry-safe reads, prove attempts remain within policy.

**Step 4: Document local execution**

Add exact commands to `tests/README.md`:

```bash
npm test -- --runTestsByPath tests/integration/discord/interaction_contract.test.ts
npm test -- --runTestsByPath tests/integration/discord/operation_faults.test.ts
```

**Step 5: Run GREEN and commit**

```bash
npm test -- --runTestsByPath tests/integration/discord/interaction_contract.test.ts tests/integration/discord/operation_faults.test.ts
git add tests/integration/discord/interaction_contract.test.ts tests/integration/discord/operation_faults.test.ts tests/README.md
git commit -m "Test Discord boundary failure contracts"
```

---

### Task 11: Roll Out and Verify in Production

**Objective:** Deploy the migration safely and prove it improves reliability without duplicate responses or messages.

**Files:**

- Modify only existing operational documentation if deployment reveals a missing verified step.

**Step 1: Complete all quality gates**

```bash
npx prettier --write src/discord tests/unit/discord tests/integration/discord docs/discord-boundary-inventory.md
npm run lint
npm run check:discord-boundary
npm test
npm run build
git diff --check
```

All must exit 0.

**Step 2: Deploy in phases**

Do not deploy the full migration as one unreviewed change. Deploy after each subsystem phase and observe at least one normal operating window before continuing.

**Step 3: Verify safe telemetry**

Logs/metrics must expose:

- operation name;
- interaction kind and command/custom-ID prefix;
- elapsed milliseconds;
- acknowledgement method and timing;
- attempts;
- classified category/code/status;
- final outcome.

Confirm they do not expose callback URLs, interaction/webhook tokens, bot authorization, raw headers, or request bodies.

**Step 4: Verify behavior**

Exercise representative flows:

- gifted and paid `/create-character`;
- read-only command;
- denied premium command;
- button that updates a message;
- button/select that opens a modal;
- modal submission;
- thread bump;
- RP proxy post;
- voice progress/final transcript publication.

Confirm no duplicate messages, stuck "thinking" states, incorrect public/ephemeral visibility, or increased restart count.

**Step 5: Review production error distribution**

After the observation window, compare:

- interaction acknowledgement latency;
- counts of `10062`, `40060`, timeout, rate-limit, and transient-network categories;
- operation retries by policy;
- container restart count;
- duplicate-send reports.

Any `10062` should be a contained, redacted event. Any boundary-related unhandled rejection blocks completion.

---

## Acceptance Criteria

- Every interaction entry point uses the responder/dispatcher contract.
- Potentially slow deferable interactions acknowledge within the configured margin below three seconds.
- Immediate modal paths call `showModal()` before any deferral or slow work. Prefilled modal paths
  either show within the acknowledgement budget or defer ephemerally and use prepared activation.
- Commands/components no longer choose raw `reply` versus `editReply` versus `followUp` themselves.
- `10062` and `40060` are classified, logged safely, never blindly retried, and never escape as unhandled rejections.
- Every inventoried outbound Discord operation has an explicit timeout and retry policy.
- Retries occur only for explicitly safe operations within bounded attempt and elapsed budgets.
- discord.js remains the owner of Discord rate-limit bucket scheduling.
- Slow/failed entitlement reads are not misrepresented as confirmed empty entitlements.
- An indeterminate entitlement check completes the deferred ephemeral response with the specified retry-later copy, makes no state change, and never shows an upgrade CTA.
- The CI boundary check blocks new bypasses.
- Full lint, test, boundary check, and build pass.
- Production verification shows no duplicate sends, interaction-state regressions, or boundary-caused container restarts.

## Required Pull Request Sequence

Implement as reviewable phases rather than a monolith:

1. Inventory/audit tooling.
2. Boundary foundation: error classification, redaction, and operation executor (Tasks 2+3).
3. Interaction responder and dispatcher plus one production vertical slice (Tasks 4+5).
4. Command migration batches.
5. Component/modal migration batches; small adjacent command/component batches may share a PR, but modal restructures remain isolated.
6. Non-interaction Discord operation migration batches.
7. ESLint enforcement and fault-injection suite (Tasks 9+10 may share a PR).

Each PR must update `docs/discord-boundary-inventory.md`, include focused RED/GREEN evidence, and pass existing repository quality gates.

## Resolved Regressions

- **IC edit prefill restored through prepared-modal activation.** `/ic-edit` and Edit IC Message
  fetch and prefill the original proxy content. Fast preparation opens the modal immediately; slow
  preparation completes the deferred ephemeral response with an owner-bound **Open editor** button.
  Modal submission still performs authoritative ownership and existence validation.
