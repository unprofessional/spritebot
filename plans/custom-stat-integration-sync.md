# Custom Stat Definitions and Integration Sync

> **Status:** Phase 1 implemented and under review; Phase 2 pending
> **Primary owner:** SPRITEbot-prime
> **Integration consumer:** SPRITE-Integrations
> **Initial adapter:** TaleSpire Symbiote
> **Product owner:** mads
> **Engineering:** Codex
> **Review:** Moldy
> **Last updated:** 2026-07-28

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
- one case-safe unique index on `(game_id, lower(stat_key))`
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

### Phase 1: Prime custom-stat identity

**Repo:** `spritebot`

- Add and backfill immutable `stat_key`.
- Add format validation and one case-safe per-game uniqueness mechanism.
- Introduce `CustomStatDefinition` application terminology.
- Require explicit keys for all runtime creation paths.
- Revalidate owner access during manual creation.
- Show immutable keys as read-only edit/card context.
- Preserve generic edit/delete behavior.
- Add migration, DAO, UI, and regression tests.

**Gate:** Existing IDs and values survive; all new definitions require valid explicit keys; no
production branch contains a built-in game system, stat set, or alias.

### Phase 2: External registry and opt-in mapping

**Repo:** `spritebot-integrations`

- Before other work, update Integrations test schema, types, and queries for Prime `stat_key`.
- Persist normalized native and user-created source descriptors.
- Generalize mappings with integration, sources, target identity, transformation, authority,
  enabled state, and audit metadata.
- Make enabled mappings the only sync opt-in.
- Migrate current mappings without changing write behavior.
- Show local-only, enabled, and disabled states.

**Gate:** Existing campaigns continue syncing and arbitrary definitions have equal mapping options.

### Phase 3: Integration-assisted registration

**Repos:** Prime contract, then Integrations consumer

- Define Prime-owned list/create operations.
- Add `Create custom stat and map`.
- Confirm creation and mapping separately.
- Make retries idempotent and transactions atomic where possible.
- Reject unauthorized or cross-game schema changes.

### Phase 4: Authority, provenance, and generic notifications

**Repo:** `spritebot-integrations`, with Prime schema support

- Centralize character/entity write-through.
- Enforce authority and stale-observation rules.
- Persist provenance.
- Replace HP-specific notification/event code with generic per-mapping rules.
- Prove identical behavior for renamed and unrelated compatible stats.

### Phase 5: Generic mapping assistance

**Repo:** `spritebot-integrations`

- Replace source-name-specific suggestion helpers and alias branches.
- Rank suggestions from descriptor shape, compatible targets, and name similarity.
- Treat TaleSpire native current/max data as one ordinary paired source.
- Require explicit GM target and authority selection.
- Preserve existing mappings during reseeding.

**Gate:** Useful suggestions work for arbitrary and renamed stats without game identity or named
stat assumptions.

### Phase 6: Symbiote feasibility and optional UI

**Repo:** `spritebot-integrations/symbiote`

- Verify API/UI constraints.
- Add discovery and mapping status.
- Optionally add scoped mapping proposals.
- Keep Discord complete.

### Phase 7: Outbound/bidirectional research

**Repos:** cross-repo design only

- Inventory writable adapter APIs/events.
- Specify revisions, retries, loop prevention, and conflict resolution.
- Do not expose bidirectional authority before the design is proven.

## Migration and Compatibility

- Migration 012 is `012_custom_stat_identity.sql`; it has not been applied remotely.
- Backfill keys without changing template IDs, labels, values, or metadata.
- Existing unmapped definitions remain local-only.
- Existing mapping rows migrate enabled/source-authoritative only to preserve current behavior,
  then appear for GM review.
- Existing HP-specific notification configuration migrates only when the target mapping is
  unambiguous; otherwise retain a compatibility fallback and request explicit selection.
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
