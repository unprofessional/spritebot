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
to 347 findings. `/ic-edit` and the Edit IC Message context command use modal restructuring pattern
3: they show a minimal replacement-content modal synchronously, perform no Discord/database read
first, and defer feature authorization plus authoritative ownership/existence validation to modal
submission. This intentionally replaces the former prefilled editor with a blank replacement
field so `showModal()` can remain the first and only initial callback.

The Task 6 support/subscription/ops batch removes 17 more direct interaction calls, bringing the
current report to 330 findings. `/support`, `/subscribe`, `/verify`, `/gift`, and `/toggle-bypass`
now use an ephemeral auto-defer policy and route all interaction responses through the responder.
The support-guild member fetch inside `/verify` remains pending the Task 8 operation-executor
migration.

The Task 6 admin-configuration batch removes 16 more direct interaction calls, bringing the
current report to 314 findings. `/admin` and `/bot-announcements` now use ephemeral auto-defer
policies. Admin handlers continue to receive the dispatcher's responder-backed interaction proxy;
their source-level interaction calls remain inventoried for the dedicated Task 7 handler migration.

The rule uses TypeScript receiver provenance from discord.js/`@discordjs` declarations, imported
REST/route symbols, and Discord URL construction. It intentionally does not flag arbitrary domain
objects that happen to expose methods such as `send`, `edit`, `delete`, or `fetch`.

## Boundary Foundation Status

Tasks 2 and 3 established the allowlisted outbound-operation foundation. Tasks 4 and 5 added the
interaction state machine and deadline-aware dispatcher, then routed `/create-character` through
the production responder policy:

| Capability                            | Boundary modules                                                       | Status      |
| ------------------------------------- | ---------------------------------------------------------------------- | ----------- |
| Error classification and redaction    | `src/discord/errors.ts`, `src/discord/logging.ts`                      | Implemented |
| Bounded policy and operation executor | `src/discord/operation_policy.ts`, `src/discord/operation_executor.ts` | Implemented |
| Interaction response state machine    | `src/discord/interaction_responder.ts`                                 | Implemented |
| Deadline-aware interaction dispatch   | `src/discord/interaction_dispatch.ts`                                  | Implemented |

`/create-character` executes behind an ephemeral, auto-defer policy with authorization inside the
1,750ms acknowledgement budget, and the mutation batch now routes its source-level responses
through the responder as well. The first Task 6 batch added narrow responder contexts for four
consistently ephemeral core commands and a synchronous public/ephemeral policy resolver for
`/roll`. The second batch applies the same narrow context to six character/game mutation and
selector-launch commands. The third batch migrates five non-modal inventory/RP commands. The
fourth isolates the two modal-first IC edit routes and explicitly moves their authorization to the
gated modal submission. The fifth migrates five support, subscription, and owner/ops commands with
ephemeral auto-defer policies. The sixth migrates the two admin-configuration commands while
preserving delegated handlers behind the dispatcher proxy. Every migrated outbound operation must
name its timeout, total budget, and retry policy.

## Migration Matrix

`Retry-safe?` describes the intended policy, not current automatic retry behavior. The completed
command batches are recorded below; all other source call sites remain pending migration.

| Area                                                          | Current files                                                                                                                                                                                                                                             | Operation type                                                                                 | Interaction deadline?                                 | Retry-safe?                                                                             | Planned adapter                                                        | Migration phase                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Interaction bootstrap and hotfix containment                  | `src/client/initial_commands.ts`, `src/discord/interaction_responder.ts`, `src/discord/interaction_dispatch.ts`                                                                                                                                           | Initial/fallback response ownership and dispatcher terminal containment                        | Yes                                                   | No callback retries                                                                     | Interaction responder and deadline-aware dispatcher                    | Tasks 4-5 complete                                                                                             |
| Command registration and presence                             | `src/client/initial_commands.ts`                                                                                                                                                                                                                          | REST construction/token setup, global/guild command `PUT`, presence write                      | No                                                    | Registration `PUT` is an idempotent-write candidate; presence policy must be explicit   | Operation executor                                                     | Task 8, entitlements/registration batch                                                                        |
| Gateway lifecycle                                             | `src/index.ts`                                                                                                                                                                                                                                            | Client `login` and `destroy`                                                                   | No                                                    | No automatic retry by default                                                           | Operation executor or documented bootstrap allowlist                   | Task 8                                                                                                         |
| Authorization member lookup                                   | `src/access/guards.ts`                                                                                                                                                                                                                                    | Guild-member SDK fetch before authorization                                                    | Yes, because it is inside interaction dispatch        | Safe-read candidate                                                                     | Deadline-aware dispatcher plus operation executor                      | Tasks 5 and 8                                                                                                  |
| Slash/context commands                                        | `src/commands/*.ts` (all 28 command files; 32 findings)                                                                                                                                                                                                   | Interaction replies, deferrals, edits, follow-ups, and modal acknowledgements                  | Yes                                                   | No callback retries                                                                     | Interaction responder                                                  | Core, character/game, inventory/RP, support, and admin batches complete; automation and voice remain in Task 6 |
| Mixed command SDK operations                                  | `src/commands/bump-thread.ts`, `src/commands/verify.ts`, `src/commands/verify-greeting.ts`                                                                                                                                                                | Channel/member fetches and verification greeting send                                          | Yes for their enclosing interactions                  | Fetches are safe-read candidates; greeting send is not retry-safe without idempotency   | Operation executor after dispatcher acknowledgement                    | Tasks 6 and 8                                                                                                  |
| Components with direct interaction calls                      | `src/components/*.ts` (29 direct-call files; 105 findings)                                                                                                                                                                                                | Replies, updates, deferrals, edits, follow-ups, and modal acknowledgements                     | Yes                                                   | No callback retries                                                                     | Interaction responder with explicit reply/component-update/modal modes | Task 7                                                                                                         |
| Builder-only components reviewed with no direct boundary call | `src/components/rebuild_list_characters_response.ts`, `src/components/stat_type_select.ts`, `src/components/view_character_card.ts`, `src/components/view_game_card.ts`, `src/components/view_game_stat_card.ts`, `src/components/view_inventory_card.ts` | Discord payload construction only                                                              | No                                                    | Not applicable                                                                          | Keep outside the controlled call-method rule                           | No migration required unless behavior changes                                                                  |
| Mixed component SDK operation                                 | `src/components/support_verify_button.ts`                                                                                                                                                                                                                 | Support-guild member fetch plus interaction response                                           | Yes                                                   | Member fetch is a safe-read candidate                                                   | Operation executor plus responder                                      | Tasks 7-8                                                                                                      |
| Handlers with direct interaction calls                        | `src/handlers/**/*.ts` (20 direct-call files; 117 findings)                                                                                                                                                                                               | Replies, component updates, deferrals, edits, follow-ups, and modal acknowledgements           | Yes                                                   | No callback retries                                                                     | Interaction responder with route-specific mode                         | Task 7                                                                                                         |
| Handler routers reviewed with no direct boundary call         | `src/handlers/button_handlers.ts`, `src/handlers/button_handlers/index.ts`, `src/handlers/modal_handlers.ts`, `src/handlers/select_menu_handlers.ts`                                                                                                      | Local routing only                                                                             | No                                                    | Not applicable                                                                          | Keep as routers around the dispatcher-owned responder                  | Tasks 5 and 7                                                                                                  |
| Mixed handler SDK operation                                   | `src/handlers/admin_orphans.handler.ts`                                                                                                                                                                                                                   | Guild-member fetch plus deferred interaction responses                                         | Yes                                                   | Member fetch is a safe-read candidate                                                   | Operation executor plus responder                                      | Tasks 7-8                                                                                                      |
| Entitlement HTTP client                                       | `src/services/discord_entitlements_api.ts`                                                                                                                                                                                                                | Raw Discord REST `GET` through native `fetch`                                                  | Yes when authorization is interactive                 | Safe-read only, bounded inside the two-second total budget                              | Operation executor with `AbortSignal`                                  | Task 8, entitlement batch                                                                                      |
| Lifecycle notifications                                       | `src/services/lifecycle_notification.service.ts`                                                                                                                                                                                                          | Guild/channel fetches and channel send                                                         | No                                                    | Fetches are safe-read candidates; send is best-effort and non-retry by default          | Operation executor                                                     | Task 8, lifecycle/support batch                                                                                |
| RP proxy operations                                           | `src/services/rp_message_proxy.service.ts`                                                                                                                                                                                                                | Channel/webhook/message reads, webhook creation/send/edit/delete, user-message replies/deletes | No callback deadline, but ordering is safety-critical | Reads may be safe; writes are non-retry unless an idempotency invariant is added        | Operation executor with explicit per-step policies                     | Task 8, RP proxy batch                                                                                         |
| Support verification                                          | `src/services/support_verification.service.ts`, `src/utils/support_verification_messages.ts`                                                                                                                                                              | Role assignment and guild-member fetch                                                         | Usually invoked by an interaction or member event     | Fetch is a safe-read candidate; role add requires an idempotency rationale              | Operation executor                                                     | Task 8, lifecycle/support batch                                                                                |
| Thread bump service                                           | `src/services/thread_bump.service.ts`                                                                                                                                                                                                                     | Thread/message fetch, archive/lock changes, send, and cleanup deletes                          | No                                                    | Reads may retry; state changes require explicit invariants; sends must avoid duplicates | Operation executor                                                     | Task 8, thread-bump batch                                                                                      |
| Thread bump orchestration                                     | `src/schedulers/per_thread_bump_manager.ts`                                                                                                                                                                                                               | Indirect calls into `ThreadBumpService`, retry queue, and backoff scheduling                   | No                                                    | Existing retry loop must defer to operation policy without duplicating sends            | Operation executor integration through the service                     | Task 8, thread-bump batch                                                                                      |
| Voice connection and publication                              | `src/voice/voice_manager.ts`, `src/voice/audio_receiver.ts`                                                                                                                                                                                               | Voice join/state/read/subscribe/destroy, channel/message fetches, transcript send              | No                                                    | Reads may be safe; joins, subscriptions, destroys, and sends default to no retry        | Operation executor with voice-specific caller outcomes                 | Task 8, voice batch                                                                                            |
| Voice progress structural adapter                             | `src/voice/progress_message.ts`                                                                                                                                                                                                                           | Structurally typed channel `send` and message `edit`                                           | No                                                    | Send is non-retry; edit requires an explicit idempotency decision                       | Operation executor, passed through typed boundary functions            | Task 8, voice batch                                                                                            |

## Modal-First Routes

The initial audit found 11 direct `showModal()` calls. The two command routes are now migrated with
pattern 3 and modal-submission authorization:

- `src/commands/ic-edit-context.ts`
- `src/commands/ic-edit.ts`

The remaining 9 calls across 8 component/handler files require explicit modal-first review because
Discord does not permit deferring and then opening a modal:

- `src/components/character_field_selector.ts`
- `src/components/edit_character_field_selector.ts`
- `src/components/edit_stat_selector.ts`
- `src/components/stat_type_selector.ts`
- `src/handlers/button_handlers/inventory_buttons.ts`
- `src/handlers/select_menu_handlers/adjust_numeric_stat_select.ts`
- `src/handlers/select_menu_handlers/character_stat_select_menu.ts`
- `src/handlers/select_menu_handlers/stat_template_dropdown.ts`

`character_stat_select_menu.ts` contains two modal calls. Task 7 must record the selected
restructuring pattern for each remaining route before migration.

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
