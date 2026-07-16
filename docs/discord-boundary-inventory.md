# Discord Boundary Inventory

This document is the migration source of truth for direct Discord interaction contracts and
outbound Discord API operations. It was generated from the repository-local
`local/discord-boundary` ESLint rule on 2026-07-15 and reviewed against the known dispatcher,
service, scheduler, and voice paths.

Run the inventory report with:

```bash
npm run audit:discord-boundary
```

Report mode exits successfully while migration warnings remain. Parser failures and unrelated
ESLint errors still fail the report. Each finding includes file, line, operation family, method,
and migration status.

## Audit Snapshot

The initial report contains 413 unmigrated direct calls across 89 files:

| Operation family  | Findings | Methods                                                                                                                                                                           |
| ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interaction       | 353      | `reply`, `deferReply`, `editReply`, `followUp`, `showModal`, `update`, `deferUpdate`                                                                                              |
| REST registration | 10       | `REST` construction, `setToken`, `put`, `Routes.applicationCommands`, `Routes.applicationGuildCommands`                                                                           |
| Raw HTTP          | 1        | `fetch` to `discord.com/api`                                                                                                                                                      |
| SDK read          | 23       | `fetch`, `fetchMessage`, `fetchWebhooks`, `entersState`, `getVoiceConnection`                                                                                                     |
| SDK write         | 26       | `add`, `createWebhook`, `delete`, `deleteMessage`, `destroy`, `editMessage`, `joinVoiceChannel`, `login`, `reply`, `send`, `setArchived`, `setLocked`, `setPresence`, `subscribe` |

After Tasks 4 and 5, the current report contains 411 findings. The two removed findings belonged
to the absorbed hotfix fallback helper; its behavior now lives in the responder/dispatcher
boundary.

The Task 6 read-only/core batch removes another 23 direct calls, bringing the current report to
388 findings. `/list-characters`, `/list-games`, `/view-character`, `/view-game`, and `/roll` now
receive a narrow responder context instead of calling Discord response methods.

The Task 6 character/game mutation batch removes 19 more direct calls, bringing the current report
to 369 findings. `/create-game`, `/create-character`, `/join-game`, `/switch-game`,
`/switch-character`, and `/restore-character` now use an ephemeral auto-defer policy and send all
command output through the responder.

The Task 6 non-modal inventory/RP batch removes 15 more direct calls, bringing the current report
to 354 findings. `/inventory`, `/ic`, `/ooc`, `/ic-delete`, and the Delete IC Message context
command now use the responder. `/inventory` also selects its business-failure payload before the
single Discord callback so a callback failure is never retried. The modal-opening `/ic-edit`
routes remain isolated for the next review unit.

The isolated Task 6 IC edit modal batch removes 7 more direct calls, bringing the current report
to 347 findings. Its initial blank-modal pattern has since been superseded by the prepared-modal
boundary: `/ic-edit` and the Edit IC Message context command fetch and preserve the original proxy
content. Fast preparation opens the prefilled modal within the acknowledgement budget. Slow
preparation safely defers ephemerally, then exposes the same prefilled modal through a short-lived,
owner-bound **Open editor** button. Submission still performs authoritative ownership and existence
validation.

The Task 6 support/subscription/ops batch removes 17 more direct interaction calls, bringing the
current report to 330 findings. `/support`, `/subscribe`, `/verify`, `/gift`, and `/toggle-bypass`
now use an ephemeral auto-defer policy and route all interaction responses through the responder.
The support-guild member fetch inside `/verify` remains pending the Task 8 operation-executor
migration.

The Task 6 admin-configuration batch removes 16 more direct interaction calls, bringing the
current report to 314 findings. `/admin` and `/bot-announcements` now use ephemeral auto-defer
policies. Admin handlers continue to receive the dispatcher's responder-backed interaction proxy;
their source-level interaction calls remain inventoried for the dedicated Task 7 handler migration.

The final Task 6 slash-command batch removes 19 more direct interaction calls, bringing the current
report to 295 findings: 235 interaction, 10 REST registration, 1 raw HTTP, 23 SDK read, and 26 SDK
write operations. `/transcribe`, `/bump-thread`, and `/verify-greeting` now use ephemeral auto-defer
policies and route every source-level `reply()` through the responder. Their existing long-operation
deferrals, reply edits, deferred error follow-up, channel fetch, and greeting send remain behind the
dispatcher proxy pending the operation-executor migration.

The first Task 7 component/handler batch removes 95 more direct interaction calls, bringing the
current report to 200 findings. Seventeen non-modal button/select components plus their routed
handler paths now use explicit reply or component-update policies.

Task 7 Batch 2A removes 8 more direct interaction calls, bringing the current report to 192
findings. Three synchronous modal-opening selectors now use a shared manual `modal-or-reply`
policy. Their existing modal payloads and ephemeral validation replies are unchanged, and
authorization runs authoritatively on the corresponding gated modal submission so no remote work
can race the initial `showModal()` acknowledgement.

Task 7 Batch 2B.1 removes 12 more findings, bringing the current report to 180. The live
`editStatSelect` route now uses the shared gated prepared-modal policy and preserves all prefilled
values on both its immediate and activation-button paths. The never-routed
`stat_template_dropdown` file was removed; its edit and delete branches duplicated the dedicated
components selected by the router.

Task 7 Batch 2B.2 removes 5 more findings, bringing the current report to 175. Both branches of
`editCharacterStatDropdown` preserve their existing prefilled core/stat modal on the fast path and
behind owner-bound prepared activation on the slow path. Existing validation remains ephemeral,
and authorization remains on the gated modal submissions.

Task 7 Batch 2B.3 removes 4 more findings, bringing the current report to 171. The
`adjustStatSelect` route now uses a component-update-aware prepared-modal policy: its fast path
opens the existing adjustment modal, its slow path leaves the original message intact and offers
private owner-bound activation, and both fast and deferred not-found paths preserve the existing
original-message replacement behavior. Authorization remains on the gated adjustment-modal
submission.

Task 7 Batch 2B.4 removes 2 more findings, bringing the current report to 169. The inventory add
and edit button routes now share the gated prepared-modal policy. Fast ownership/item lookups keep
the immediate blank add modal, prefilled edit modal, and ownership denial unchanged. Slow lookups
preserve the same modal behind owner-bound activation, while the gated modal submissions repeat
ownership validation before mutation.

The consolidated final Task 7 batch removes 97 findings, bringing the current report to 72. All
remaining component, button/select-handler, and modal-handler interaction responses now flow
through explicit deadline-aware responder policies. Message-replacement routes use component
updates, read-only/private routes use ephemeral replies, and inventory modal submissions select
their contract from source-message availability. Unknown button/select/modal routes are also
dispatcher-owned. No direct interaction callback calls remain under `src/components/` or
`src/handlers/`.

The rule uses TypeScript receiver provenance from discord.js/`@discordjs` declarations, imported
REST/route symbols, and Discord URL construction. It intentionally does not flag arbitrary domain
objects that happen to expose methods such as `send`, `edit`, `delete`, or `fetch`.

## Boundary Foundation Status

Tasks 2 and 3 established the allowlisted outbound-operation foundation. Tasks 4 and 5 added the
interaction state machine and deadline-aware dispatcher, then routed `/create-character` through
the production responder policy:

| Capability                             | Boundary modules                                                        | Status      |
| -------------------------------------- | ----------------------------------------------------------------------- | ----------- |
| Error classification and redaction     | `src/discord/errors.ts`, `src/discord/logging.ts`                       | Implemented |
| Bounded policy and operation executor  | `src/discord/operation_policy.ts`, `src/discord/operation_executor.ts`  | Implemented |
| Interaction response state machine     | `src/discord/interaction_responder.ts`                                  | Implemented |
| Deadline-aware interaction dispatch    | `src/discord/interaction_dispatch.ts`                                   | Implemented |
| Prefilled modal preparation/activation | `src/discord/prepared_modal.ts`, `src/discord/interaction_responder.ts` | Implemented |

`/create-character` executes behind an ephemeral, auto-defer policy with authorization inside the
1,750ms acknowledgement budget, and the mutation batch now routes its source-level responses
through the responder as well. The first Task 6 batch added narrow responder contexts for four
consistently ephemeral core commands and a synchronous public/ephemeral policy resolver for
`/roll`. The second batch applies the same narrow context to six character/game mutation and
selector-launch commands. The third batch migrates five non-modal inventory/RP commands. The
fourth isolates the two modal-first IC edit routes and explicitly moves their authorization to the
gated modal submission. The fifth migrates five support, subscription, and owner/ops commands with
ephemeral auto-defer policies. The sixth migrates the two admin-configuration commands while
preserving delegated handlers behind the dispatcher proxy. The seventh migrates the remaining three
slash commands while preserving their proxy-intercepted deferral, edit, and follow-up calls. Every
migrated outbound operation must name its timeout, total budget, and retry policy.

The first Task 7 component batch migrates 17 non-modal button and select-menu routes. Message
replacement routes use component-update policies, while detail and verification routes use
ephemeral reply policies; modal-opening component routes remain on the reviewed legacy path. The
prepared-modal vertical slice restores IC edit prefill and establishes the required fast/slow
pattern for the remaining prefilled editors without changing the audit count.

Task 7 Batch 2A migrates the three synchronous modal selectors. They share a manual hybrid policy,
skip pre-modal component authorization, and retain authorization on the gated modal submission.

Task 7 Batch 2B.1 migrates the stat-template editor through prepared-modal activation. It also
removes the original unrouted combined stat-template dropdown handler after verifying the router
uses the dedicated edit and delete selector components.

Task 7 Batch 2B.2 migrates both branches of the character field/stat editor through the same
prepared-modal policy, preserving biography text and stat current/max values across both timing
paths.

Task 7 Batch 2B.3 adds a component-update-aware prepared-modal mode for numeric-stat adjustment.
This keeps immediate modal and original-message update behavior unchanged while safely handling
slow hydration with either a deferred original-message edit or private prepared activation.

Task 7 Batch 2B.4 migrates the inventory add and edit modal-opening buttons through prepared-modal
activation. This completes the direct modal-first inventory review without changing either modal's
fields or prefilled values.

The final Task 7 batch migrates the remaining eight legacy components, every ordinary inventory
button action, the delete-stat selector, and all modal submissions. Component and select/button
routers now return a policy for every route, and the modal router chooses a message-update or
ephemeral-reply contract before dispatch. Task 7 is complete.

The first Task 8 batch routes the raw entitlement `GET` through the operation executor with an
800ms attempt timeout, a two-second total budget, at most two safe-read attempts, and
`AbortSignal` cancellation. Gifted and active cached access still resolve before the remote call.
Remote timeout, transient, rate-limit, authentication, malformed-response, and other failures are
typed as authorization unavailable rather than treated as a confirmed empty entitlement set. The
interactive guard completes the deferred ephemeral response with retry-later copy and never shows
an upgrade CTA for this outcome.

The final Task 8 batch routes every remaining REST, SDK, voice, and Discord-hosted attachment
operation through `src/discord`. The audit has fallen from 71 to 10 findings; all 10 are the known
proxy-intercepted interaction callbacks in `/transcribe` and `/bump-thread`, with no non-interaction
findings remaining.

### Task 8 Operation Policies

| Operation family                         | Attempt / total budget                          | Retry policy                                      | Failure behavior                                                                                                   |
| ---------------------------------------- | ----------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Command registration `PUT`               | 10s / 25s                                       | Idempotent write, 2 attempts                      | Startup logs the bounded registration failure; the same full command document is safe to replace                   |
| Presence, gateway login/destroy          | 5s / 5s presence/destroy; 30s login             | Never                                             | Best-effort presence is logged; startup login fails closed; shutdown continues through its existing step isolation |
| Interactive member/channel reads         | 800ms / 2s authorization; otherwise 1.5s / 4s   | Safe read, 2 attempts                             | Existing private denial/error copy is preserved                                                                    |
| Lifecycle guild/channel reads and send   | 2s / 5s reads; 3s send                          | Reads retry twice; send never                     | Per-target failure is counted and cannot crash the process                                                         |
| Support role assignment                  | 2s / 5s                                         | Idempotent write, 2 attempts                      | Existing verification permission/configuration error is preserved                                                  |
| Thread reads and archive/lock state      | 1.5s / 4s reads; 2s / 5s writes                 | Reads retry twice; exact state writes retry twice | Scheduler retains its existing bounded caller retry behavior                                                       |
| Thread bump send/delete                  | 3s send; 2s delete                              | Never                                             | An indeterminate send is never duplicated; cleanup failure is non-fatal                                            |
| RP reads and text attachment download    | 1.5s / 4s SDK reads; 2s / 5s attachment         | Safe read, 2 attempts                             | Existing failed/not-found outcomes are preserved                                                                   |
| RP webhook creation/send/replies/deletes | 2-5s single-attempt budgets                     | Never                                             | No duplicate webhook/message creation; original user message remains unless every proxy chunk is recorded          |
| RP edit                                  | 2s / 5s                                         | Idempotent write, 2 attempts                      | Replays the exact replacement content only                                                                         |
| Voice connection and receiver lifecycle  | 1-21s operation-specific single-attempt budgets | Never                                             | Existing startup/stop/partial-result handling is preserved                                                         |
| Voice Discord reads                      | 2s / 5s                                         | Safe read, 2 attempts                             | Missing identities/channels retain existing fallbacks                                                              |
| Voice progress/transcript sends          | 3-5s                                            | Sends never; exact progress edits retry twice     | No duplicate transcript/progress messages; idempotent progress content may be replayed                             |

## Migration Matrix

`Retry-safe?` describes the intended policy, not current automatic retry behavior. The completed
command batches are recorded below; all other source call sites remain pending migration.

| Area                                                          | Current files                                                                                                                                                                                                                                             | Operation type                                                                                   | Interaction deadline?                                 | Retry-safe?                                                                           | Planned adapter                                                        | Migration phase                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Interaction bootstrap and hotfix containment                  | `src/client/initial_commands.ts`, `src/discord/interaction_responder.ts`, `src/discord/interaction_dispatch.ts`                                                                                                                                           | Initial/fallback response ownership and dispatcher terminal containment                          | Yes                                                   | No callback retries                                                                   | Interaction responder and deadline-aware dispatcher                    | Tasks 4-5 complete                                                                 |
| Command registration and presence                             | `src/client/initial_commands.ts`                                                                                                                                                                                                                          | REST construction/token setup, global/guild command `PUT`, presence write                        | No                                                    | Registration `PUT` retries as an exact idempotent replacement; presence never retries | Operation executor                                                     | Task 8 complete                                                                    |
| Gateway lifecycle                                             | `src/index.ts`                                                                                                                                                                                                                                            | Client `login` and `destroy`                                                                     | No                                                    | No automatic retry                                                                    | Operation executor                                                     | Task 8 complete                                                                    |
| Authorization member lookup                                   | `src/access/guards.ts`                                                                                                                                                                                                                                    | Guild-member SDK fetch before authorization                                                      | Yes, because it is inside interaction dispatch        | Safe read, bounded inside the authorization budget                                    | Deadline-aware dispatcher plus operation executor                      | Tasks 5 and 8 complete                                                             |
| Slash/context commands                                        | `src/commands/*.ts` (4 files; 13 findings)                                                                                                                                                                                                                | Proxy-intercepted interaction deferrals, edits, and follow-ups plus mixed-command SDK operations | Yes                                                   | No callback retries                                                                   | Interaction responder                                                  | Task 6 command responder migration complete; mixed SDK operations remain in Task 8 |
| Mixed command SDK operations                                  | `src/commands/bump-thread.ts`, `src/commands/verify.ts`, `src/commands/verify-greeting.ts`                                                                                                                                                                | Channel/member fetches and verification greeting send                                            | Yes for their enclosing interactions                  | Fetches retry as safe reads; greeting send never retries                              | Operation executor after dispatcher acknowledgement                    | Task 8 SDK operations complete                                                     |
| Component interaction responses                               | No direct calls remain under `src/components/*.ts`                                                                                                                                                                                                        | Replies, updates, deferrals, edits, follow-ups, and modal acknowledgements                       | Yes                                                   | No callback retries                                                                   | Interaction responder with explicit reply/component-update/modal modes | Task 7 complete                                                                    |
| Builder-only components reviewed with no direct boundary call | `src/components/rebuild_list_characters_response.ts`, `src/components/stat_type_select.ts`, `src/components/view_character_card.ts`, `src/components/view_game_card.ts`, `src/components/view_game_stat_card.ts`, `src/components/view_inventory_card.ts` | Discord payload construction only                                                                | No                                                    | Not applicable                                                                        | Keep outside the controlled call-method rule                           | No migration required unless behavior changes                                      |
| Mixed component SDK operation                                 | `src/components/support_verify_button.ts`                                                                                                                                                                                                                 | Support-guild member fetch plus interaction response                                             | Yes                                                   | Safe read, 2 attempts                                                                 | Operation executor plus responder                                      | Tasks 7 and 8 complete                                                             |
| Handler interaction responses                                 | No direct calls remain under `src/handlers/**/*.ts`                                                                                                                                                                                                       | Replies, component updates, deferrals, edits, follow-ups, and modal acknowledgements             | Yes                                                   | No callback retries                                                                   | Interaction responder with route-specific mode                         | Task 7 complete                                                                    |
| Handler routers reviewed with no direct boundary call         | `src/handlers/button_handlers.ts`, `src/handlers/button_handlers/index.ts`, `src/handlers/modal_handlers.ts`, `src/handlers/select_menu_handlers.ts`                                                                                                      | Local routing only                                                                               | No                                                    | Not applicable                                                                        | Keep as routers around the dispatcher-owned responder                  | Tasks 5 and 7                                                                      |
| Mixed handler SDK operation                                   | `src/handlers/admin_orphans.handler.ts`                                                                                                                                                                                                                   | Channel fetch plus responder-owned interaction responses                                         | Yes                                                   | Safe read, 2 attempts                                                                 | Operation executor plus responder                                      | Tasks 7 and 8 complete                                                             |
| Entitlement HTTP client                                       | `src/services/discord_entitlements_api.ts`                                                                                                                                                                                                                | Raw Discord REST `GET` through native `fetch`                                                    | Yes when authorization is interactive                 | Safe-read, two attempts maximum within a two-second total budget                      | Operation executor with `AbortSignal`                                  | Task 8 entitlement batch complete                                                  |
| Lifecycle notifications                                       | `src/services/lifecycle_notification.service.ts`                                                                                                                                                                                                          | Guild/channel fetches and channel send                                                           | No                                                    | Reads retry safely; send is best-effort and never retries                             | Operation executor                                                     | Task 8 complete                                                                    |
| RP proxy operations                                           | `src/services/rp_message_proxy.service.ts`                                                                                                                                                                                                                | Channel/webhook/message reads, webhook creation/send/edit/delete, user-message replies/deletes   | No callback deadline, but ordering is safety-critical | Reads retry; exact edits retry; creation, sends, replies, and deletes never retry     | Operation executor with explicit per-step policies                     | Task 8 complete                                                                    |
| Support verification                                          | `src/services/support_verification.service.ts`, `src/utils/support_verification_messages.ts`                                                                                                                                                              | Role assignment and guild-member fetch                                                           | Usually invoked by an interaction or member event     | Reads retry safely; exact role-set addition is idempotent                             | Operation executor                                                     | Task 8 complete                                                                    |
| Thread bump service                                           | `src/services/thread_bump.service.ts`                                                                                                                                                                                                                     | Thread/message fetch, archive/lock changes, send, and cleanup deletes                            | No                                                    | Reads and exact state changes retry; sends/deletes never retry                        | Operation executor                                                     | Task 8 complete                                                                    |
| Thread bump orchestration                                     | `src/schedulers/per_thread_bump_manager.ts`                                                                                                                                                                                                               | Indirect calls into `ThreadBumpService`, retry queue, and backoff scheduling                     | No                                                    | Service prevents per-attempt send retries; existing scheduler policy remains bounded  | Operation executor integration through the service                     | Task 8 complete                                                                    |
| Voice connection and publication                              | `src/voice/voice_manager.ts`, `src/voice/audio_receiver.ts`                                                                                                                                                                                               | Voice join/state/read/subscribe/destroy, channel/message fetches, transcript send                | No                                                    | Reads retry; joins, subscriptions, destroys, and sends never retry                    | Operation executor with voice-specific caller outcomes                 | Task 8 complete                                                                    |
| Voice progress structural adapter                             | `src/voice/progress_message.ts`                                                                                                                                                                                                                           | Structurally typed channel `send` and message `edit`                                             | No                                                    | Send never retries; exact content edit is idempotent and retries twice                | Operation executor, passed through typed boundary functions            | Task 8 complete                                                                    |

## Modal-First Routes

The initial audit found 11 direct `showModal()` calls. Every inventoried route now uses an explicit
modal policy. The two command routes use the hybrid prepared-modal pattern with modal-submission
authorization:

- `src/commands/ic-edit-context.ts`
- `src/commands/ic-edit.ts`

The numeric-stat selector now uses the component-update-aware prepared-modal pattern: fast
hydration opens its modal immediately, while slow hydration offers owner-bound activation without
replacing the original message. Inventory add/edit buttons use the reply-aware prepared-modal
pattern so fast ownership/item lookups retain the original modal UX and slow lookups retain the
same modal behind owner-bound activation. No unreviewed direct `showModal()` calls remain.

## Rule Scope and Allowlist

The migration allowlist is intentionally limited to `src/discord/**`, the target boundary
directory. Existing bootstrap, command, component, handler, service, scheduler, and voice files are
not exempt. Task 9 will promote the warning to an error after the inventory reaches zero unexplained
violations.

Two reviewed paths are retained in the matrix even though static receiver provenance cannot report
them as direct Discord SDK calls:

- `src/voice/progress_message.ts` deliberately hides Discord channel/message objects behind local
  structural interfaces.
- `src/schedulers/per_thread_bump_manager.ts` orchestrates Discord work indirectly through
  `ThreadBumpService`.

They are migration dependencies, not exemptions.
