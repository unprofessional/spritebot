# Custom Stat Definitions and Integration Sync

> **Status:** Phases 1-2 implemented and merged; Phase 3 contract ready for review
> **Primary owner:** SPRITEbot-prime
> **Integration consumer:** SPRITE-Integrations
> **Initial adapter:** TaleSpire Symbiote
> **Product owner:** mads
> **Engineering:** Codex
> **Review:** Moldy
> **Last updated:** 2026-07-28
>
> **Naming note:** "Prime" and "Integrations" are internal shorthands to disambiguate the two
> repos (`spritebot` and `spritebot-integrations`). These terms must never appear in user-facing
> copy, Discord UI strings, documentation, or error messages.

## Purpose

Treat every named game stat as a game-defined custom stat and make each custom stat
independently configurable for integration sync.

Prime defines generic stat machinery: immutable identity, value shape, validation, values, and
integration contracts. It must not contain compiled-in knowledge of a game system, named stat
set, alias set, notification meaning, or setup default. Names such as HP, FP, MP, Stress, and Ammo
are representative user-defined data only.

Prime owns games, definitions, characters, entities, and canonical values. Integrations owns
external-stat discovery, opt-in mappings, authority, and adapter behavior. TaleSpire native HP is
an external current/max source pair; it has no assumed Prime target.

## Current State

Prime already stores game-level definitions in `stat_template`, with canonical values in
`character_stat_field` and `game_entity_stat_field`. The legacy `character_custom_field` and
`game_entity_custom_field` tables contain freeform per-record metadata and are not stat
definitions.

Integrations already observes TaleSpire native and arbitrary stats, maps them through
`stat_template_mapping`, and writes mapped character/entity values. Its current implementation
still contains HP-specific discovery, alias, notification, and event behavior. This plan replaces
that behavior with generic source descriptors, mappings, rules, and explicit GM choices.

## Terminology

### Custom stat definition

The game-level schema for a named stat: immutable stable key, editable display label, value type,
defaults, required state, sort order, validation, and presentation metadata. This is the
application role of `stat_template`.

### Custom stat value

The canonical value of one definition on a character or game entity.

### Freeform custom field

Legacy per-record metadata that does not participate in game-level stat validation, defaults, or
integration mapping.

### External source descriptor

An integration-observed value identified by adapter and stable external key, with a display name,
shape/type, and optional grouping such as current/max pair membership. Native and user-created
sources have equal standing.

### Sync mapping

A campaign- and integration-scoped opt-in rule connecting one or more source descriptors to one
Prime custom stat definition. No enabled mapping means local-only for that integration.

### Authority policy

The mapping-owned rule that decides which side may overwrite the canonical value. Authority is
never inferred from a stat name or game system.

## Core Decisions

1. **Prime has no named core stats or game-system branches.**
2. **Prime remains canonical** for definitions and canonical values.
3. **`stat_template` is the definition model;** no parallel HP or integration-only stat model.
4. **Stable identity is explicit.** New definitions require an immutable `stat_key`; labels are
   editable and never serve as integration identity.
5. **Legacy label normalization is migration-only.** Runtime creation never derives a key.
6. **Sync is independently opt-in per mapping.** Discovery never creates, maps, or enables.
7. **Authority belongs to the mapping,** not to a source name, target name, or adapter.
8. **Initial sync remains inbound-only.** Outbound behavior requires a separately approved,
   loop-safe delivery contract.
9. **Reusable templates are deferred.** A future template feature must be a generic,
   data-driven/user-defined catalog without compiled-in game branches.

## Data Model

### Prime custom-stat identity

Extend `stat_template` with:

- `stat_key TEXT NOT NULL`
- format constraint `^[a-z][a-z0-9_]{0,63}$`
- one per-game unique constraint on `(game_id, stat_key)`; the lowercase format constraint makes
  this case-safe
- an immutable-key database trigger

Existing rows receive deterministic collision-safe keys derived from labels in migration 012.
The migration preserves template IDs, labels, character values, entity values, and metadata.
Empty or punctuation-only labels fall back to `stat`; leading digits gain `stat_`; long keys are
truncated; collisions gain numeric suffixes. New definitions must supply their key explicitly.

Application types use `CustomStatDefinition` while preserving `StatTemplate` as a compatibility
alias and retaining existing table names.

### Integrations source registry

Persist campaign-scoped descriptors containing:

- integration key
- stable source key and display label
- observed value shape/type
- optional current/max grouping metadata
- first/last observation timestamps
- adapter metadata

TaleSpire native HP is described as a current/max pair through the same descriptor shape available
to other paired sources. Arbitrary source stats retain their original display names.

### Integrations mapping

Evolve `stat_template_mapping` with:

- integration key
- stable source descriptor key(s)
- target Prime definition ID/key
- transformation and options
- authority policy
- enabled state
- optional generic notification rules
- audit actor and timestamps

Initial authority policies are `source_authoritative`, `prime_authoritative`, and `manual`.
Do not add a global `syncable` flag or an unimplemented `bidirectional` option.

### Provenance

Successful integration writes record integration, source campaign/key, source timestamp or
revision, mapping ID/version, and last writer. The write path rejects unauthorized authority,
stale observations, foreign/deleted targets, and values incompatible with the target definition.

## Registration and Mapping UX

### Prime Discord UI

- Create a definition with explicit stable key, label, type, and defaults.
- Show the immutable key as read-only context during later editing.
- Preserve edit/delete parity for every definition.
- Eventually show mapping state and authority per integration.
- Prevent deletion while active mappings exist, or require mapping removal first.

Prime exposes no game-system selector or built-in stat bundle.

### Integrations Discord UI

- Show all accessible Prime definitions and observed source descriptors.
- Map compatible source descriptors to an existing definition.
- Offer `Create custom stat and map` with explicit GM confirmation.
- Choose enabled state and authority independently.
- Show local-only, disabled, stale, invalid, and target-missing states.

Creation initiated by Integrations must use Prime-owned validation and idempotency rules. A
service API is preferred long-term; any interim direct database contract must remain narrowly
scoped and tested against Prime schema.

### Generic mapping assistance

Suggestions may use only:

- generic source descriptors and grouping metadata
- compatible target value shapes
- lightweight name similarity as a non-authoritative hint
- explicit GM selection and confirmation

A TaleSpire current/max source pair may be suggested for any compatible Prime count definition.
No particular target key, label, alias, game identity, notification meaning, or authority default
may be assumed. Ambiguous candidates require GM choice. Suggestions never create or enable.

### Symbiote UI

The Symbiote may later display discovery and mapping status or submit mapping proposals through
campaign-scoped endpoints. Discord remains the complete fallback. The Symbiote never receives
direct Prime database access or deployment-wide credentials.

## Write Path and Enforcement

One Integrations service handles character and entity writes:

1. Resolve campaign, linked Prime game, and target record.
2. Load enabled mappings.
3. Resolve the target definition by immutable identity and revalidate game ownership.
4. Transform source values into the target shape.
5. Enforce authority and stale-update rules.
6. Validate and atomically upsert value plus provenance.
7. Return per-stat written/skipped/error diagnostics.

Notifications are optional generic mapping rules such as change threshold or minimum-value event.
They may target any compatible mapped definition and remain disabled until explicitly configured.

## Delivery Phases

Each phase below is an implementation contract, not a topic list. A phase PR must satisfy its own
objective, dependencies, invariants, deliverables, failure behavior, tests, user-visible copy, and
acceptance gate without relying on an implementer to reconstruct requirements from another section.
If a phase discovers that one of these contracts must change, update and approve this plan before
implementing the changed behavior.

### Phase 1: Prime custom-stat identity

**Status:** Implemented and merged in `spritebot`.

**Objective:** Give every Prime custom-stat definition an explicit immutable identity without
introducing a game system, named-stat bundle, preset, alias catalog, or second definition model.

**Delivered contract:**

- `stat_template.stat_key` is required, lowercase, format-validated, immutable, and unique per game.
- Migration 012 deterministically backfills collision-safe keys while preserving definition IDs,
  labels, metadata, and character/entity values.
- Runtime creation requires a caller-supplied key; labels are never converted into runtime identity.
- Prime UI exposes the key as read-only context and preserves generic definition edit/delete parity.
- DAO updates use an explicit runtime column allowlist.
- `CustomStatDefinition` is the application term; existing storage names and the `StatTemplate`
  compatibility alias remain.

**Historical acceptance gate:** Existing IDs and values survived; initialized production and PGlite
schemas enforce the same identity rules; all new definitions require valid explicit keys; no
production branch contains a built-in game system, stat set, preset, or alias.

### Phase 2: External-stat registry and opt-in mapping contract

**Status:** Implemented and merged in `spritebot-integrations` through
`fb8f92699d5db14bf27420523c1199f2dbc5796d`.

**Objective:** Give Integrations stable adapter-owned source identity and independently controlled
per-stat mappings so inbound sync never depends on mutable display names or named-stat privilege.

**Dependencies and references:**

- Prime Phase 1 immutable `stat_key` contract.
- The terminology, source registry, mapping, registration, security, and migration sections above.
- Existing TaleSpire roster caching and inbound write-through must remain operational throughout the
  additive rollout.

**Invariants:**

- A source is identified by `(campaign_id, integration_key, source_key)`; its display name is not
  identity.
- Native TaleSpire fields and arbitrary user-created fields use distinct adapter-owned namespaces.
- Grouped values pair only through stable `group_key` and `group_role` descriptors.
- Discovery records observations only. It never creates a Prime definition, creates a mapping, or
  enables sync.
- Enabled mappings are the only inbound sync opt-in. Missing or disabled mappings remain local-only.
- Authority, enablement, source identity, and target identity belong to each mapping independently.
- HP, FP, MP, Stress, Ammo, and other names have no production mapping privilege.

**Delivered Integrations contract:**

- Persist campaign-scoped external descriptors with stable source key, display name, value shape,
  value type, optional group identity/role, adapter metadata, and observation timestamps.
- Resolve native and arbitrary TaleSpire sources into separate namespaces while allowing identical
  display names.
- Broaden mixed-type observations deterministically in the order text, number, then boolean.
- Persist integration, stable current/max source keys, stable Prime target key/ID, mapping type,
  authority, enabled state, actor, audit metadata, and timestamps.
- Resolve review, manual mapping, and write-through by stable source identity.
- Present enabled, disabled/local-only, ignored, unresolved, stale, and legacy-collision states.
- Paginate mapping controls so every row remains actionable beyond Discord's 25-option limit.
- Migrate unambiguous legacy mappings as enabled and source-authoritative to preserve behavior.
- Preserve ambiguous legacy case collisions deterministically as disabled synthetic rows, explain
  the required action, prevent their enablement, and provide authorized per-row removal.
- Preserve action history on toggles and transactionally record attributable collision-removal audit
  events before deleting synthetic rows.
- Isolate additive descriptor-discovery failures from roster caching, established write-through, and
  notification processing.

**Failure and recovery behavior:**

- Descriptor persistence failure is logged and reported diagnostically but does not abort established
  sync work.
- Disabled mappings do not write and do not create perpetual setup warnings.
- Missing, stale, or invalid mapping targets are surfaced without guessing a replacement.
- Legacy collisions remain disabled until a GM removes the synthetic row and explicitly reviews the
  surviving source; the system never chooses based on casing or label similarity.

**User-visible copy and PR requirements:**

- Mapping copy must say custom stat, source, mapping, enabled, disabled/local-only, stale, or action
  required as appropriate; it must not present any representative stat as system-defined.
- The PR summary must call out stable identity, native/arbitrary namespace separation, per-row
  enablement, legacy recovery, pagination, and user-visible state changes.

**Non-goals:**

- Creating Prime definitions from discovery, enabling sync automatically, or selecting authority for
  the GM.
- Removing all remaining HP-specific notification/event behavior; Phase 4 owns that replacement.
- Completing generic suggestion cleanup; Phase 5 removes the remaining named aliases/helpers.
- Outbound delivery or a Symbiote mutation path.

**Required evidence:**

- Native and arbitrary sources with colliding names remain distinct.
- Display-name casing changes retain source identity.
- Native current/max cannot pair with an arbitrary lookalike max, and manual mappings persist both
  stable component keys.
- Legacy case collisions migrate without a unique-index failure and cannot be enabled.
- Mappings after row 25 can be toggled.
- Initial action history and collision-removal attribution remain queryable.
- Descriptor failure isolation, local-only behavior, authorization, tenant scope, build, lint,
  formatting, and the full Integrations suite pass.

**Acceptance gate:** Existing campaigns continue syncing through unambiguous migrated mappings;
arbitrary definitions have equal mapping options; all controls remain reachable; ambiguous legacy
rows have a safe visible recovery path; no runtime decision maps by display name or named-stat rule.

### Phase 3: Integration-assisted registration

**Status:** Ready for implementation only after this contract is approved.

**Objective:** Let an authorized GM create one ordinary Prime custom-stat definition from an
observed Integrations source and then explicitly map that source, without making discovery itself a
schema mutation or sync consent.

**Repos and delivery order:**

1. `spritebot` defines and tests the Prime registration contract and initialized schema.
2. `spritebot-integrations` consumes that exact contract and adds the Discord workflow.
3. The Prime contract must merge and deploy before the Integrations consumer is enabled.

**Dependencies and references:**

- Phase 1 definition identity and validation.
- Phase 2 descriptor, mapping, audit, pagination, and tenant-isolation contracts.
- Prime remains the owner of definition invariants even when Integrations initiates the request.
- For this phase, implement the boundary as two Prime-owned PostgreSQL functions created by a Prime
  migration and called through Integrations' existing dedicated Prime database connection:
  `list_custom_stat_definitions(p_game_id uuid)` and `register_custom_stat_definition(...)`. Do not
  add raw `stat_template` reads/inserts in the new Integrations workflow, a second write path, or an
  HTTP service in this phase. Both repos document the functions' request/result contract and exercise
  it against Prime's ordinary initialized schema. Prime may replace the transport with a service API
  later without changing the product-level contract below.

**Cross-repo list and registration requests:**

`list_custom_stat_definitions(p_game_id uuid)` returns only non-deleted definitions from one existing,
non-deleted game, including stable ID/key, label, field type, defaults/options, required state, sort
order, and presentation metadata. A missing/deleted game returns `target_missing`; it never falls back
to another game or returns deployment-wide definitions.

`register_custom_stat_definition(...)` accepts only Prime-domain inputs:

- linked Prime `game_id`
- explicit immutable `stat_key`
- display label
- supported Prime field type and type-compatible defaults/options
- acting Discord user ID (audit — not authorization; authorization is enforced by the caller)
- caller-generated opaque idempotency key

Its SQL inputs are `p_game_id uuid`, `p_stat_key text`, `p_label text`, `p_field_type text`,
`p_default_value text`, `p_is_required boolean`, `p_sort_order integer`, `p_meta jsonb`,
`p_actor_discord_user_id text`, and `p_idempotency_key text`. It returns one of: `created`,
`existing_equivalent`, `conflict`, `unauthorized`, `invalid`, or `target_missing`, plus the stable
Prime definition ID/key when successful. Idempotency is scoped by `(game_id, idempotency_key)`. Do
not make callers infer an outcome from a generic database error.

Integration-domain context (integration key, campaign ID, guild ID) is **not** a Prime function
parameter. Integrations records its own campaign/integration audit context in
`stat_template_mapping_audit` when it maps the newly created definition. Prime records only who
asked, what was created, and whether it was a replay.

**Authorization and sequencing invariants:**

- Creation begins only from an explicit GM interaction; observation, status rendering, autocomplete,
  and suggestion generation are read-only.
- Revalidate `ManageGuild`, active campaign, campaign guild, linked Prime game, and current target
  existence when each confirmation is executed, not only when the menu was rendered.
- Integrations is the policy-enforcement point for Discord `ManageGuild` and campaign-to-game scope:
  it passes only the active campaign's stored linked game ID. The Prime function validates that the
  game still exists and is not deleted, treats the database caller as the trusted service identity,
  and records the human actor. Actor metadata is not itself authorization, and no public caller may
  invoke the function with an arbitrary game ID.
- Prime applies the same key, label, type, default, metadata, and uniqueness validation used by its
  native creation path.
- Definition creation and mapping are two explicit confirmations. The first confirmation shows the
  exact Prime definition; the second shows source, target, authority, and enabled/local-only state.
- Creation does not imply mapping. Mapping does not imply enabled sync. Authority and enabled state
  require explicit GM choices and are revalidated at mapping confirmation.
- A source may map only to the newly created/equivalent definition in the campaign's linked game.

**Idempotency and transaction behavior:**

- **Replay** (same idempotency key + equivalent payload): returns the same definition as `created` or
  `existing_equivalent` without a duplicate row or duplicate audit event. This is the timeout/retry
  case.
- **Replayed key, changed payload** (same idempotency key + different inputs): fails as `conflict`.
  The caller must generate a new idempotency key to submit a genuinely different definition.
- **Convergent creation** (same `(game_id, stat_key)` from a different idempotency key with
  compatible immutable/type-defining inputs): returns `existing_equivalent` and the existing
  definition. This is the "someone else already made it" case. The caller may proceed directly to
  mapping without re-creating.
- **Conflicting creation** (same `(game_id, stat_key)` from a different idempotency key with
  incompatible inputs): fails visibly as `conflict` with the existing key, so the caller can present
  the collision and let the GM rename or select the existing definition.

Integrations UX must distinguish replay from convergent creation: replay may silently continue the
pending flow; convergent creation should confirm that the GM wants to map to the pre-existing
definition rather than assuming their intent.

- Prime definition creation and its registration audit record commit atomically.
- Mapping creation and its mapping audit record commit atomically in Integrations.
- Do not pretend the two databases share one transaction. If Prime creation succeeds and mapping
  fails or is abandoned, retain the valid definition as local-only and offer `Retry mapping`; never
  delete it automatically as rollback.
- Retry after an unknown/timeout outcome uses the same idempotency key before offering another create.

**Prime deliverables (`spritebot`):**

- The Prime-owned list function and registration function with the exact scope and result semantics
  above. In this phase the registration function is created for Integrations consumption; Prime's
  existing native DAO creation path (`StatTemplateDAO.create()`) continues to operate unchanged.
  Consolidating Prime's native Discord modals to use the same function is desirable for consistency
  but is **not** a Phase 3 deliverable — it may be done as a follow-up once the function proves
  stable. Integrations must not duplicate label/key/type rules in handwritten SQL.
- Durable idempotency and registration audit storage with actor, request fingerprint, outcome,
  definition ID, and timestamps. This storage is Prime-domain only; integration/campaign context
  belongs in Integrations' own audit tables.
- Function-level validation that can create only one definition in the supplied existing game and
  cannot update arbitrary Prime rows. Do not broaden the existing Integrations database role as part
  of this work; document its current privileges as operational debt if function-only grants cannot
  yet be enforced safely.
- Typed request/result documentation consumable by Integrations.
- Initialized-schema and migration coverage; do not apply the migration remotely during the PR.

**Integrations deliverables (`spritebot-integrations`):**

- List Prime definitions for mapping selection through `list_custom_stat_definitions`, always using
  the active campaign's stored linked game ID. Never query or list cross-game definitions.
- The existing `listSpritebotStatTemplatesByGame` raw-query DAO continues to serve established code
  paths (write-through, review, status). New Phase 3 UI flows must use the function. Migrating
  existing read paths to the function is deferred and not a Phase 3 deliverable.
- Add `Create custom stat and map` to the existing paginated mapping flow.
- Collect explicit key, label, field type, defaults/options, authority, and initial enabled/local-only
  choice without deriving key from the observed label.
- Render separate creation and mapping confirmation screens and preserve a stable pending-flow
  idempotency key across retries.
- Consume structured Prime outcomes and provide retry/reselect/review recovery rather than raw SQL or
  generic internal errors.
- Record actor and before/after context for mapping confirmation.

**Failure and recovery behavior:**

- Authorization or campaign-link changes invalidate the pending flow and require starting again.
- Target deletion between creation and mapping produces `target_missing`; refresh Prime definitions
  and let the GM reselect or create again.
- Key/type conflict preserves the observed source and presents the conflicting key without silently
  modifying either definition.
- Prime unavailable/timeout leaves the operation unresolved, performs no mapping, and retries through
  the same idempotency key.
- Integrations unavailable after Prime success leaves a valid local-only definition and an explicit
  mapping retry path.

**User-visible copy and PR requirements:**

- Confirmation copy must distinguish `Create definition` from `Map source` and `Enable inbound sync`.
- Show immutable target key, editable label, source display name, source integration, target shape,
  authority, and enabled/local-only choice before mutation.
- Success copy must not say sync is active unless the mapping is enabled and committed.
- Both repo PR summaries must document the cross-repo request/result contract, deployment order,
  idempotency behavior, partial-success recovery, authorization, and all changed Discord copy.

**Non-goals:**

- Automatic creation from discovery or suggestions.
- Bulk creation, presets, reusable game-system templates, or label-derived keys.
- Editing/deleting arbitrary Prime definitions from Integrations.
- Outbound delivery, bidirectional authority, or Symbiote mutation UI.
- Treating legacy freeform custom fields as definitions.

**Required tests:**

- Authorized creation, unauthorized actor, stale permissions, unlinked campaign, cross-game target,
  deleted game, invalid key/type/default, and conflicting key.
- Same-key same-payload replay, same-key changed-payload conflict, concurrent duplicate request, and
  timeout/unknown-outcome retry with one resulting definition and audit event.
- Separate creation/mapping confirmations and no mutation on cancel, expiry, autocomplete, discovery,
  suggestion, or status rendering.
- Prime-success/mapping-failure recovery leaves one local-only definition and can later map it.
- Mapping confirmation revalidates target, actor, authority, and enabled choice.
- All supported Prime field shapes, including generic scalar and current/max-compatible count.
- Discord flows remain usable beyond 25 observed sources/targets.
- Contract tests run against Prime's ordinary initialized test schema, not a reduced permissive mock.

**Acceptance gate:** An authorized GM can explicitly create one generic definition and separately map
and enable it; retries cannot duplicate definitions or audits; partial failure has a usable recovery
path; every mutation is scoped and attributable; neither repo adds named-stat or game-system logic.

### Phase 4: Authority, provenance, and generic notifications

**Objective:** Make every inbound character/entity write enforce the mapping's authority and replay
rules, atomically preserve write provenance with the canonical Prime value, and replace named-stat
notifications with optional generic per-mapping rules.

**Repos and delivery order:**

- `spritebot` first supplies any additive canonical-value provenance schema/validation contract.
- `spritebot-integrations` then centralizes enforcement and notification behavior.
- Additive Prime schema deploys before Integrations begins writing it.

**Dependencies and references:**

- Phase 1 immutable target identity.
- Phase 2 stable source identity and per-mapping `authority`/`enabled` state.
- Phase 3 is not required for writes to existing definitions, but newly registered definitions must
  behave identically.

**Authority invariants for inbound-only delivery:**

- `source_authoritative`: a fresh valid observation may update the canonical Prime value.
- `prime_authoritative`: inbound observations remain cached/visible in Integrations but never
  overwrite Prime; because outbound is not implemented, surface this as a deliberate skipped state,
  not as successful synchronization.
- `manual`: inbound observations remain cached and require an explicit authorized apply action before
  changing Prime. The apply action revalidates mapping, target, value, actor, and observation age.
- Disabled/missing mappings are local-only and perform no canonical write under every authority.
- Authority is read from the mapping at execution time and never inferred from a source/target name.

**Freshness, replay, and provenance invariants:**

- Use an adapter observation timestamp/revision plus stable source identity and mapping identity to
  order writes. Server receipt time alone must not make an older source observation fresh.
- An exact replay of an already applied revision/value is an idempotent no-op.
- An older revision is skipped as stale. The same revision with a different value is a visible
  conflict and does not overwrite canonical state.
- The canonical value and provenance commit in one Prime transaction. Provenance records integration,
  campaign, source key(s), source revision/timestamp, mapping ID/version, actor or service writer,
  prior/new value, and application time.
- Mapping edits invalidate unsafe assumptions: a replay under a different target or transformation is
  evaluated against the current mapping/version and never silently treated as the old write.
- Character and game-entity targets use the same validation and enforcement service.

**Prime deliverables (`spritebot`):**

- Additive provenance representation attached to or transactionally coupled with canonical custom-stat
  values for both characters and game entities.
- Prime-owned validation operation that checks target existence, same-game ownership, field shape,
  required/default rules, and compatible transformed value before atomic value/provenance upsert.
- Read support sufficient for Integrations diagnostics and manual-apply confirmation.
- Migration and initialized-schema parity without remotely applying migrations during review.

**Integrations deliverables (`spritebot-integrations`):**

- One write orchestration service for character and entity values; remove parallel native-HP and
  arbitrary-stat write branches.
- Per-stat result diagnostics: `written`, `unchanged`, `local_only`, `authority_skipped`, `stale`,
  `conflict`, `invalid`, `target_missing`, or `error`.
- Manual-apply flow gated by `ManageGuild`, with current source/canonical values and mapping shown at
  confirmation and actor recorded on success.
- Generic notification rules owned by mappings. The initial supported semantics are numeric
  absolute-change threshold and numeric minimum crossing; both default disabled.
- Minimum events fire only when a committed canonical value crosses from above to at/below the
  configured threshold, not on every observation while below. Change events use the committed
  prior/new canonical values.
- Notifications are queued/emitted only after the canonical transaction succeeds and include generic
  source/target labels rather than named event meanings.
- Remove production HP-specific debt, including `campaigns.hp_change_threshold`,
  `collectHpNotificationEvents`, `character_down`, named-target checks, and runtime HP aliases. Migrate
  old configuration only when one target mapping is unambiguous; otherwise retain it disabled as an
  actionable unresolved record.

**Failure and recovery behavior:**

- One stat's invalid/stale/conflicting value does not abort unrelated stat processing; report a
  bounded per-stat diagnostic summary.
- Prime transaction failure produces no provenance, no success counter, and no notification.
- Notification delivery failure does not roll back an already committed canonical value; persist or
  report retryable delivery state without reapplying the write.
- Missing/deleted/cross-game targets disable or quarantine the unsafe write path and require GM review;
  never remap by label.
- Provenance persistence failure fails closed for the canonical write.

**User-visible copy and PR requirements:**

- Status and manual confirmation distinguish cached external value, canonical Prime value, authority
  skip, stale replay, conflict, validation failure, and successful write.
- Notification configuration uses generic wording and states the compatible value shapes.
- PR summaries in both repos enumerate removed named-stat behavior, migration outcomes, authority
  semantics, provenance fields, diagnostics, and changed notification/status copy.

**Non-goals:**

- Outbound writes or claiming `prime_authoritative` is synchronized externally.
- Last-write-wins conflict resolution, clock-only guessing, or automatic authority changes.
- Named events such as downed/dead/HP loss in generic core.
- Cross-stat formulas or notification rules that depend on a compiled game system.

**Required tests:**

- All authority modes, disabled/absent mappings, exact replay, stale revision, same-revision conflict,
  mapping version change, invalid transform/value, deleted target, and cross-game target.
- Atomic canonical value/provenance rollback for characters and entities.
- Manual apply authorization, stale confirmation, cancellation, and actor attribution.
- Generic threshold/minimum-crossing rules on unrelated numeric/count fixtures, including no repeat
  while below and no event on failed write.
- Notification failure after successful write cannot duplicate the canonical update on retry.
- Legacy HP configuration has deterministic unambiguous migration and disabled actionable ambiguity.
- Representative names have identical behavior after rename; production control flow has no named
  source/target branches.

**Acceptance gate:** Character and entity writes produce identical generic results; authority and
freshness are enforced at execution; value plus provenance are atomic; notification semantics are
mapping-owned and name-agnostic; unresolved legacy behavior cannot execute silently.

### Phase 5: Generic mapping assistance

**Objective:** Provide useful explainable suggestions for arbitrary source and target names using
only descriptors, compatible shapes, stable grouping, and non-authoritative name similarity.

**Repo:** `spritebot-integrations`.

**Dependencies and references:**

- Phase 2 already supplies stable descriptors, grouping, mappings, pagination, and basic review.
- Phase 4 supplies final target compatibility and authority semantics if implemented first; suggestion
  generation must not weaken either contract.
- Phases 4 and 5 may ship in either order. The write path (Phase 4) and the suggestion path (Phase 5)
  are logically independent: the write path does not call suggestion helpers, and suggestions do not
  call write/notification code. Each phase's tests must pass independently of whether the other has
  shipped.

**Invariants:**

- Shape/type compatibility is a hard filter. Name similarity can rank compatible candidates but can
  never make an incompatible target eligible.
- Current/max sources pair exclusively through descriptor `group_key`/`group_role` and stable source
  keys; labels and aliases do not form groups.
- A suggestion contains source descriptor(s), compatible target identity/shape, confidence,
  explanation, and proposed mapping type only. It does not contain implicit consent.
- Suggestions never create a Prime definition, create/replace a mapping, select authority, or enable
  sync. Every mutation requires explicit GM selection and confirmation.
- Existing confirmed mappings survive descriptor reseeding and suggestion recomputation.
- Ambiguous compatible candidates remain visible choices; the service does not pick a winner from a
  game identity or named-stat catalog.

**Deliverables:**

- Remove production source-name-specific helpers and alias branches, including `suggestHpMapping`,
  `isHpCurrent`, `isHpMax`, `isHpTemplate`, and hard-coded `statAliases`, except narrowly scoped
  migration parsing that cannot run as ongoing suggestion logic.
- Build a generic candidate pipeline: load stable descriptors, form valid groups, filter compatible
  Prime targets, score bounded name similarity, and return deterministic ranked explanations.
- Define and document confidence thresholds. Bulk acceptance may include only explicitly displayed,
  currently valid suggestions at or above the selected threshold and must record the actor per result.
- Revalidate descriptor, target, compatibility, campaign/game scope, and current permissions when a
  suggestion is confirmed; stale suggestions refresh instead of mutating.
- Keep manual mapping complete even when no useful suggestion exists.

**Failure and recovery behavior:**

- Descriptor or Prime target lookup failure leaves existing mappings untouched and reports review as
  temporarily unavailable.
- Stale/missing candidate at confirmation returns to refreshed review.
- Similar names with incompatible shape receive no suggestion rather than a coerced transform.
- Duplicate display names remain independently selectable by stable source key with disambiguating
  integration/group context.

**User-visible copy and PR requirements:**

- Show why a suggestion exists: compatible shape, paired components, and/or label similarity.
- Display confidence as assistance, not certainty, and identify ambiguous alternatives.
- Never call a suggestion automatic setup or imply it has already enabled sync.
- PR summary lists every removed named-stat helper/alias, scoring inputs, confidence thresholds,
  stale-confirmation behavior, and changed review copy.

**Non-goals:**

- Machine-learned or opaque ranking, game detection, bundled presets, or compiled alias catalogs.
- Automatic definition creation, mapping, authority selection, or enablement.
- Replacing manual mapping or Discord-only setup.

**Required tests:**

- Arbitrary renamed scalar and count fixtures with no HP-like names.
- Native current/max plus arbitrary lookalike names cannot cross-pair.
- Duplicate display names remain distinct; casing changes preserve identity.
- Incompatible shape is excluded despite exact label match.
- Ambiguous equal candidates require GM choice with deterministic ordering.
- Suggestion recomputation preserves mappings; stale confirmation mutates nothing.
- Bulk acceptance revalidates every row, records actors, and cannot exceed Discord control limits.
- Static/manual review confirms representative names exist only as adapter descriptors, migration
  compatibility, fixtures, or copy examples—not privileged production branches.

**Acceptance gate:** Suggestions are useful for arbitrary and renamed stats, every recommendation is
explainable from generic inputs, manual mapping remains complete, and no game identity or named-stat
assumption influences eligibility or mutation.

### Phase 6: Symbiote feasibility and optional mapping UI

**Objective:** Determine whether TaleSpire's Symbiote environment can safely expose scoped discovery
and mapping status, and implement only the subset that preserves Discord as the complete management
path and explicit GM confirmation boundary.

**Repo:** `spritebot-integrations`, including `symbiote` assets and campaign-scoped API routes.

**Dependencies and references:**

- Phase 2 descriptor/mapping status is the minimum dependency.
- Phase 3 registration and Phase 5 suggestions may be displayed only after their server contracts are
  complete; their mutation rules do not move into the client.
- The Symbiote already has live authenticated routes for roster sync and campaign status. This phase's
  feasibility question is specifically about **mapping management** in the Symbiote, not the Symbiote
  platform itself. Existing routes and their authentication/scoping patterns are the starting point,
  not assumed proof of secure mutation support.

**Feasibility deliverable (required before UI implementation):**

- Document available Symbiote identity, campaign storage, authentication, secret exposure, request,
  event, rate, payload, and UI constraints using current TaleSpire documentation and a checked-in PoC.
- Threat-model copied campaign credentials, cross-campaign reads, forged proposals, replay, stale UI,
  compromised browser context, and leakage of Prime/internal IDs.
- Decide one of:
  - `read_only`: status/discovery can be exposed safely; all mutations continue in Discord;
  - `proposal_only`: the client may submit a scoped proposal that remains inert until an authorized
    Discord confirmation; or
  - `no_go`: keep the Symbiote unchanged and document why.
- Product-owner approval of that decision is the gate for any optional UI work. A `no_go` conclusion
  with evidence is a valid completed phase.

**Implementation invariants if approved:**

- The Symbiote receives no Prime database credentials, deployment-wide service credential, or direct
  database access.
- Every endpoint authenticates and scopes by campaign on the server; client-supplied campaign/game,
  mapping, target, or user IDs are untrusted and re-resolved.
- Read responses expose only the minimum display/status data required by the active campaign.
- A proposal never creates a Prime definition, creates/changes a mapping, changes authority, or
  enables sync. Mutation occurs only through the existing authorized Discord confirmation path.
- Proposal tokens are opaque, campaign-scoped, expiring, single-use or replay-safe, and bound to the
  descriptor/target versions displayed.
- Discord supports complete discovery, manual mapping, registration, recovery, authority, and
  enable/disable behavior without the Symbiote.

**Optional deliverables:**

- Read-only discovery/mapping/health status with clear enabled, local-only, stale, conflict, and action
  required states.
- If `proposal_only` is approved, submit a bounded proposal and generate a Discord review handoff for
  an authorized GM; do not accept authority or enablement from the client as final.
- Graceful unavailable/stale states that do not interrupt TaleSpire roster sync.

**Failure and recovery behavior:**

- Authentication, campaign-scope, replay, stale-version, or malformed-request failure mutates nothing
  and returns a bounded user-safe error.
- API unavailability leaves Discord management and established sync operational.
- A proposal whose descriptor/target/mapping changes before Discord confirmation expires and refreshes.
- Rate limiting or duplicate events coalesce safely without duplicate proposals or audit records.

**User-visible copy and PR requirements:**

- Label the UI as status or proposal, never as completed mapping until Discord confirmation commits.
- Do not expose raw internal IDs, credentials, stack traces, or named-stat assumptions.
- PR summary includes the feasibility evidence/decision, threat model, endpoint scopes, Discord
  fallback proof, all client copy, and explicit features not implemented.

**Non-goals:**

- Direct Prime writes, direct mapping mutations, storing privileged credentials in campaign blobs, or
  making the Symbiote required for setup.
- Reimplementing validation, authority, idempotency, or suggestion logic in client JavaScript.
- Outbound/bidirectional delivery.

**Required tests/evidence:**

- Current TaleSpire API/Manifest documentation references and a reproducible local PoC.
- Authentication missing/invalid, copied credential, cross-campaign request, forged IDs, replay,
  expiry, stale versions, malformed payload, rate limit, and API outage.
- No client bundle/manifest contains privileged credentials.
- Proposal submission alone changes no Prime definition or Integrations mapping.
- Discord can complete every management and recovery operation with Symbiote disabled.
- Existing roster event/fetch behavior and retry paths remain unchanged.

**Acceptance gate:** A documented approved feasibility decision exists; any shipped UI is strictly
campaign-scoped and non-authoritative until Discord confirmation; disabling the Symbiote removes no
management capability and breaks no established sync.

### Phase 7: Outbound/bidirectional research

**Objective:** Produce an approval-ready design proving whether each adapter can safely deliver Prime
changes outward without feedback loops, silent conflicts, or false synchronization claims.

**Repos:** Cross-repo design and disposable PoCs only. No production authority option or write path is
part of this phase.

**Dependencies and references:**

- Phase 4 provenance and inbound replay semantics are prerequisites for a credible design.
- Each adapter is evaluated independently; TaleSpire capability does not become a generic guarantee.

**Required research deliverables:**

- Inventory writable adapter APIs/events, authentication, permissions, target identity, revision or
  ETag support, rate limits, offline behavior, batch semantics, partial failures, and confirmation
  signals using current primary documentation and PoCs.
- Define a per-mapping outbound state machine covering queued, delivered, acknowledged, retryable,
  conflicted, rejected, superseded, and dead-letter outcomes.
- Specify an idempotency key and durable outbox boundary so a Prime commit and outbound intent cannot
  diverge silently even though the external delivery is not in the Prime transaction.
- Specify loop prevention using write provenance/correlation and adapter observations; time windows or
  value equality alone are insufficient proof.
- Specify conflict detection/resolution for source-authoritative, prime-authoritative, and manual
  mappings, including simultaneous edits, stale offline clients, and adapters without revisions.
- Specify ordering, retry/backoff, deduplication, poison-event handling, reconciliation, operator/GM
  visibility, manual retry/resolve, and audit retention.
- Define how enablement and authority transitions affect queued/in-flight work.
- Document security boundaries, least-privilege credentials, secret rotation, tenant isolation, and
  external target revalidation.
- Provide sequence diagrams and a failure-mode test matrix for normal delivery, duplicate callback,
  echo observation, timeout after external success, partial batch success, out-of-order event,
  permission revocation, target deletion, and service restart.

**Required decisions:**

- For each adapter, classify outbound as `supported`, `manual_only`, or `not_safe` with evidence.
- Define exactly what UI/status language may call synchronized versus pending, conflicted, or
  unsupported.
- Decide whether an adapter lacking revisions/acknowledgements can support anything beyond manual
  export/apply.
- Estimate schema, queue, API, operational, migration, and observability work as a separately approved
  implementation plan.

**Failure and safety behavior:**

- Research code cannot mutate production external data or introduce a dormant production write flag.
- An unsupported or ambiguous adapter fails closed as inbound-only/manual; it is never labeled
  bidirectional.
- No conflict policy defaults to last-write-wins merely because one event arrived later.

**Non-goals:**

- Production outbound delivery, exposing a `bidirectional` authority value, or changing current sync
  behavior.
- Generalizing one adapter's capabilities to all integrations.
- Treating polling, timestamps, or echo suppression delays as proven loop prevention by themselves.

**Required evidence and PR copy:**

- Link primary adapter documentation with access dates and check in sanitized PoC results.
- Record unresolved assumptions and operational costs, not only the happy path.
- The design PR summary states clearly that no outbound behavior ships and identifies every follow-up
  implementation/migration phase requiring separate approval.

**Acceptance gate:** Product owner and architecture review explicitly approve an adapter-specific
state machine, outbox/idempotency boundary, loop prevention, conflict policy, security model, failure
matrix, and implementation estimate. Until then, production remains inbound-only and no UI or schema
claims bidirectional support.

## Migration and Compatibility

- Migration 012 is `012_custom_stat_identity.sql`. Applying migrations to remote environments is
  operational deployment work and is never part of a phase implementation or review PR.
- Backfill keys without changing template IDs, labels, values, or metadata.
- Existing unmapped definitions remain local-only.
- Existing mapping rows migrate enabled/source-authoritative only to preserve current behavior,
  then appear for GM review.
- Existing HP-specific notification configuration migrates only when the target mapping is
  unambiguous; otherwise preserve it as unresolved and disabled, surface the required GM action,
  and do not execute an HP-specific runtime fallback.
- Never infer a game system or mapping from labels.
- Preserve freeform custom fields untouched.
- Roll out additive schemas before dependent application code.

## Security and Permissions

- Only the Prime owner or explicitly authorized GM/admin may create definitions or change mapping
  authority.
- Registration and authority changes record actor, timestamp, and old/new state.
- External metadata is untrusted: normalize keys, cap lengths, validate types, and never use labels
  as SQL identifiers.
- A campaign cannot map outside its linked Prime game.
- Autocomplete/discovery is not authorization; execution revalidates current ownership and scope.

## Test Matrix

At minimum:

- legacy backfill for empty, punctuation-only, leading-digit, duplicate/case-colliding, truncated,
  and non-ASCII labels
- preservation of template IDs and character/entity values
- explicit-key validation and immutable updates
- case-safe per-game uniqueness
- runtime DAO update allowlist rejecting identity and unknown columns
- arbitrary/renamed definition parity using representative HP, FP, MP, Stress, and Ammo fixtures
- native and user-created source discovery
- independent mapping enablement and authority
- local-only values untouched
- generic current/max transformations and notifications on unrelated count stats
- character/entity parity
- stale, replayed, disabled, deleted-target, validation, and cross-game failures
- complete Discord-only setup

## Out of Scope

- Any named stat or game-system behavior in Prime core
- Built-in presets, selected-preset persistence, or compiled alias catalogs
- A template marketplace in this implementation
- Treating freeform custom fields as stat definitions
- Automatic creation or sync enablement from discovery
- Bidirectional sync before an outbound contract exists

A future reusable-template feature must be a separate generic, data-driven/user-defined catalog.

## Definition of Done

- Prime has one stable game-defined custom-stat model and no named/game-specific production logic.
- Runtime creation requires explicit immutable keys.
- Every definition can independently remain local-only or be mapped with explicit authority.
- Integrations discovers arbitrary sources and maps them to compatible existing or newly confirmed
  definitions.
- Current/max sources use the same transformation and write path regardless of names.
- Discovery and suggestions never create or enable.
- Character/entity writes enforce authority, provenance, validation, and staleness identically.
- Existing definitions, mappings, and values migrate without silent loss.
