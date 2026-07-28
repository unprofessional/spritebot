# Game Field Definitions and Integration Sync

> **Status:** Proposed
> **Primary owner:** SPRITEbot-prime
> **Integration consumer:** SPRITE-Integrations
> **Initial adapter:** TaleSpire Symbiote
> **Product owner:** mads
> **Engineering:** Codex
> **Review:** Moldy
> **Last updated:** 2026-07-28

## Purpose

Make game-specific fields first-class without promoting any one game's vocabulary into SPRITE core.

HP and FP are fields in the FFRP game system. They are not universal SPRITE fields. An FFRP campaign should receive HP and FP as seeded game-field definitions, while another game can define a completely different schema. TaleSpire can then map its native and custom stats to those definitions and, where configured, become the authoritative writer for their values.

This plan owns the abstraction in SPRITEbot-prime because Prime owns games, characters, entities, field definitions, and canonical values. SPRITE-Integrations owns external-field discovery, source-to-field mappings, and adapter-specific sync behavior. The TaleSpire Symbiote is a client of that integration contract, not the owner of HP or FP.

## Current State

Prime already has most of the storage primitives:

- `stat_template` defines game-owned fields shared by characters and game entities.
- `character_stat_field` and `game_entity_stat_field` hold canonical values.
- `character_custom_field` and `game_entity_custom_field` hold ad hoc per-record fields.
- Prime's Discord UI lets a GM create and edit stat templates.

Integrations already has most of the TaleSpire bridge:

- The Symbiote reports native HP as `hp_current` and `hp_max` and reports arbitrary TaleSpire stats by name.
- `stat_template_mapping` maps observed TaleSpire names to Prime `stat_template` rows.
- Integrations can write mapped values into character and game-entity stat fields.
- The mapping review UI suggests HP pairs and name/alias matches, including FP aliases.

The missing pieces are stable field identity, reusable game-system presets, explicit source authority, integration-assisted field registration, and provenance/conflict rules. Today the system can map TaleSpire stats only after the target Prime templates already exist, and HP-specific behavior still leaks into adapter code and notifications.

## Terminology

### Game field definition

A reusable field declared by a game, such as FFRP `hp`, FFRP `fp`, or another game's `stress`. This is the conceptual role currently served by `stat_template`.

A definition has:

- stable machine key
- display label
- value shape/type
- default value
- required/optional state
- sort order
- validation and presentation metadata

### Field value

The canonical value of one game field on one character or game entity. Existing `character_stat_field` and `game_entity_stat_field` remain the storage model.

### Ad hoc custom field

A field created only on one character or entity. Existing custom-field tables remain valid, but these fields are not integration-sync targets until promoted to a game field definition.

### Source field

A field exposed by an integration, identified by adapter and stable external key. Examples include TaleSpire `hp_current`, `hp_max`, `FP`, and `FP Max`.

### Field mapping

A campaign-scoped rule connecting one or more source fields to one Prime game field definition, including transformation and authority policy.

### Authority policy

The rule deciding which side may overwrite a canonical value. Authority belongs to the campaign mapping, not globally to the field definition.

## Core Decisions

1. **Prime remains canonical.** Field definitions and canonical values live in SPRITEbot-prime.
2. **`stat_template` evolves into the game-field definition model.** Do not create a parallel generic field-definition table unless implementation research finds a hard incompatibility.
3. **Per-record custom fields stay separate.** An arbitrary character custom field is not silently syncable. It must first be promoted or recreated as a game field definition.
4. **Stable keys replace label identity.** Integrations map to immutable field keys/IDs, never mutable display labels.
5. **Presets seed definitions; they do not create core fields.** FFRP seeds HP and FP for an FFRP game. Games without a selected preset receive no HP/FP assumptions.
6. **Authority is explicit per mapping.** Initial TaleSpire defaults for FFRP HP and FP are source-authoritative. Existing mappings are preserved as inbound/manual until reviewed.
7. **Discovery is not registration.** Observing a TaleSpire stat may suggest a field, but it must not silently mutate the Prime game schema.
8. **The first release remains inbound-only.** Do not claim bidirectional sync until a real Prime-to-adapter delivery path, loop prevention, and conflict tests exist.

## Proposed Data Model

### Prime: stable game field identity

Extend `stat_template` with:

- `field_key TEXT`
- a case-insensitive uniqueness constraint per active game, for example `UNIQUE (game_id, lower(field_key))`
- optional structured validation/presentation data in the existing `meta` JSONB initially

Rules:

- `field_key` is immutable after creation.
- Keys use a conservative normalized format such as `^[a-z][a-z0-9_]{0,63}$`.
- Labels remain editable and user-facing.
- New fields require a key; existing rows are backfilled deterministically from their labels with collision suffixes.
- API and integration contracts expose both the immutable field ID and field key.

Do not rename the table in the first implementation. A table rename adds migration risk without changing the product model. Application types and docs may use `GameFieldDefinition` while maintaining compatibility with `stat_template` storage.

### Prime: presets

Define versioned game-system presets in application code first, not as mutable global database rows.

Example FFRP preset:

```ts
{
  key: 'ffrp',
  version: 1,
  fields: [
    {
      fieldKey: 'hp',
      label: 'HP',
      fieldType: 'count',
      required: true,
      defaultValue: '0/0'
    },
    {
      fieldKey: 'fp',
      label: 'FP',
      fieldType: 'count',
      required: true,
      defaultValue: '0/0'
    }
  ]
}
```

Persist the selected preset key/version on `game` so setup is reproducible and future migrations can distinguish seeded fields from hand-created fields. Applying a preset is additive and idempotent by `field_key`; it never deletes or overwrites a GM-customized field without confirmation.

### Integrations: source field registry

Add a campaign-scoped registry of observed source fields. A source descriptor should include:

- integration key, initially `talespire`
- stable source key
- display label
- observed value shape/type
- optional grouping metadata such as current/max pair membership
- first/last observed timestamps
- adapter metadata

For TaleSpire, use stable normalized source keys while retaining the raw display name. Native HP should remain an explicit pair (`hp_current`, `hp_max`). Custom TaleSpire stats should receive deterministic normalized keys and retain their original names for display and troubleshooting.

### Integrations: generalized mapping

Evolve `stat_template_mapping` rather than creating a second TaleSpire-only mapping system. Add or clarify:

- `integration_key`
- target Prime field key/ID
- source field key(s)
- transformation type and options
- authority policy
- enabled/disabled state
- creation/update actor and timestamps

Initial authority policies:

- `source_authoritative`: accepted external updates overwrite the canonical Prime value.
- `prime_authoritative`: inbound updates are observed but do not overwrite Prime.
- `manual`: no automatic write until the mapping is reviewed/enabled.

Reserve bidirectional behavior for a later phase. Do not add a nominal `bidirectional` option that cannot actually deliver outbound changes.

### Prime values: provenance

Record enough provenance on successful integration writes to explain the current value and reject stale updates:

- integration key
- source campaign and field key
- source observation timestamp or monotonic revision when available
- mapping ID/version
- last writer

The existing value-row `meta` JSONB can hold provenance initially. Add a real `updated_at` column to both canonical value tables if needed for deterministic ordering and diagnostics.

The write contract must reject or no-op:

- a source write against a Prime-authoritative/manual mapping
- a stale observation older than the accepted source revision/timestamp
- a mapping whose target field no longer belongs to the linked game
- a value that fails the target field's validation

## Registration and Mapping UX

### Prime Discord UI

Extend the existing game field setup UI rather than introducing a second concept named custom fields.

Required flows:

- select a game-system preset when creating or editing a game
- preview fields before applying a preset
- create a game field manually with stable key, label, type, and defaults
- promote an ad hoc character/entity custom field into a game field definition, with explicit value migration choices
- show which fields are mapped to integrations and which source currently has authority
- prevent destructive field deletion while active mappings exist, or require mappings to be removed first

### Integrations Discord UI

Extend the existing mapping review UI:

- show observed source fields and available Prime game fields
- map to an existing field
- offer `Create game field and map` when no target exists
- require explicit confirmation before creating the Prime field
- choose authority, defaulting to `source_authoritative` for newly accepted TaleSpire mappings
- show stale, invalid, or target-missing mappings

Field creation initiated from Integrations must use the same Prime-owned validation and idempotency rules as Prime UI. While the direct database bridge remains, implement one narrowly scoped Prime field-registration DAO/service contract and test it against Prime schema. Longer term, route this through a service API rather than unrestricted cross-database writes.

### Symbiote UI

Treat Symbiote-side registration as a later convenience layer, not a prerequisite for the model.

Feasibility/design phase:

- expose observed TaleSpire source descriptors in the Symbiote
- fetch the campaign's Prime field definitions and current mappings through the scoped campaign API
- let a GM propose or select mappings
- send mapping requests to Integrations for validation and persistence
- never expose direct Prime database access or service-wide credentials

If the Symbiote API/UI constraints make safe schema editing awkward, keep schema creation in Discord and use the Symbiote for discovery/status only. The core contract must not depend on Symbiote UI support.

## FFRP and TaleSpire Defaults

When an Integrations campaign links to a Prime game using the FFRP preset:

1. Ensure the Prime game contains `hp` and `fp` definitions from the versioned preset.
2. If TaleSpire native HP fields are observed and no conflicting mapping exists, suggest or seed:
   - `hp_current` + `hp_max` -> `hp`
   - transformation: `count_pair`
   - authority: `source_authoritative`
3. If TaleSpire `FP` and `FP Max` (or an unambiguous equivalent pair) are observed, suggest:
   - current + max source pair -> `fp`
   - transformation: `count_pair`
   - authority: `source_authoritative`
4. Do not guess ambiguous FP aliases such as `focus` versus `fatigue` without confirmation unless the selected preset explicitly defines the alias.
5. Never seed HP/FP mappings for non-FFRP games merely because similarly named TaleSpire stats exist. Continue to offer them as normal mapping suggestions.

This is the intended meaning of “HP/FP are TaleSpire-authoritative defaults”: they are FFRP preset fields with default TaleSpire mapping/authority policy, not universal core columns or hard-coded canonical labels.

## Write Path and Enforcement

Centralize mapped writes through one integration-write service in SPRITE-Integrations. Both player characters and game entities must use the same resolution, transformation, validation, authority, provenance, and stale-update logic.

The service flow:

1. Resolve campaign, linked Prime game, and target character/entity.
2. Load enabled mappings for the integration campaign.
3. Resolve the target field by immutable ID/key and verify game ownership.
4. Transform source values into the target shape.
5. Enforce authority and stale-update policy.
6. Validate the result against the Prime field definition.
7. Upsert the canonical value and provenance atomically.
8. Return per-field written/skipped/error diagnostics.

HP-change notifications should consume the resolved canonical `hp` field mapping rather than hard-coded raw TaleSpire names. Notification behavior remains adapter-aware only where it needs source events; field identity and thresholds should be based on the mapped game field.

## Delivery Phases

### Phase 1: Prime field identity and presets

**Repo:** `spritebot`

- Add/backfill immutable `field_key` on `stat_template`.
- Add uniqueness and validation constraints.
- Introduce application-level `GameFieldDefinition` terminology/types without a risky table rename.
- Add selected preset key/version to games.
- Implement an idempotent preset service and FFRP v1 with HP/FP count fields.
- Add Prime UI for preset application and stable-key manual field creation.
- Add migration, DAO/service, UI, and regression tests.

**Gate:** Existing games and templates retain all values; a new or existing game can apply FFRP v1 exactly once and receive HP/FP without duplicates.

### Phase 2: Integration field registry and mapping contract

**Repo:** `spritebot-integrations`

- Persist normalized source field descriptors from TaleSpire sync payloads.
- Generalize mappings with integration key, stable source keys, target field identity, authority, enabled state, and audit metadata.
- Migrate existing mapping rows without changing current write behavior.
- Update mapping review/status output and tests.

**Gate:** Existing TaleSpire campaigns continue syncing; every observed source field has stable identity and every mapping has an explicit authority state.

### Phase 3: Integration-assisted registration

**Repos:** `spritebot` contract first, then `spritebot-integrations` consumer

- Define Prime-owned create/list field operations and validation rules.
- Add `Create game field and map` to Integrations mapping review.
- Make creation plus mapping idempotent and transactional where possible.
- Prevent cross-game targets and unauthorized schema changes.
- Add contract tests in both repos.

**Gate:** A GM can map an arbitrary TaleSpire field even when no Prime field exists, without manually leaving the setup flow or creating an ad hoc per-character field.

### Phase 4: Authority and provenance enforcement

**Repo:** `spritebot-integrations`, with Prime schema support

- Centralize character/entity write-through.
- Enforce source-authoritative, Prime-authoritative, and manual policies.
- Persist provenance and reject stale source observations.
- Base HP notifications on the canonical mapped field.
- Add replay, out-of-order, disabled mapping, deleted target, validation, and conflict tests.

**Gate:** TaleSpire-authoritative fields update deterministically; Prime/manual fields cannot be overwritten by inbound sync; diagnostics explain every skipped write.

### Phase 5: FFRP TaleSpire defaults

**Repo:** `spritebot-integrations`

- Detect the linked Prime game's FFRP preset/version.
- Seed or strongly suggest the HP and FP count-pair mappings.
- Default those mappings to TaleSpire/source authority.
- Preserve explicit GM mappings and never overwrite them during reseeding.
- Add FFRP and non-FFRP acceptance tests.

**Gate:** A fresh FFRP setup reaches intended HP/FP mappings with minimal confirmation, while a non-FFRP game receives no hidden HP/FP schema or authority decisions.

### Phase 6: Symbiote mapping UI feasibility and optional implementation

**Repo:** `spritebot-integrations/symbiote`

- Verify TaleSpire Symbiote API/UI constraints.
- Add source discovery and mapping status.
- If safe and usable, add mapping proposal/registration through scoped Integrations endpoints.
- Keep Discord as the complete fallback path.

**Gate:** Symbiote UI can improve setup but is not required to define fields, recover mappings, or administer authority.

### Phase 7: Outbound/bidirectional research

**Repos:** cross-repo design only until approved

- Inventory TaleSpire APIs/events that can accept writes.
- Specify revisions, loop prevention, retries, and conflict resolution.
- Decide whether any field truly needs bidirectional behavior.
- Do not implement or expose bidirectional authority until the design is proven.

## Migration and Compatibility

- Backfill stable keys without changing template IDs, labels, or field values.
- Treat all existing Integrations mappings as enabled inbound mappings matching today's behavior, but flag them for authority review in setup status.
- Do not automatically classify existing games as FFRP based only on HP/FP labels.
- Offer an explicit `Apply FFRP preset` action that reuses matching unambiguous fields or asks before collisions.
- Preserve existing ad hoc custom fields untouched.
- Keep current TaleSpire raw-stat caches for diagnostics and replay while canonical writes move to the generalized contract.
- Roll out schema changes additively before application code depends on them.

## Security and Permissions

- Only the Prime game owner or an explicitly authorized GM/admin may create definitions or change authority.
- Symbiote requests use campaign-scoped credentials, not the deployment-wide webhook secret targeted for replacement in the TaleSpire launch plan.
- All registration and authority changes record actor, timestamp, and old/new state.
- Integration source metadata is untrusted input: normalize keys, cap lengths, validate types, and never use source labels as SQL identifiers.
- A campaign cannot map to a field outside its linked Prime game.

## Test Matrix

At minimum, cover:

- stable-key backfill with duplicate/case-colliding labels
- preset application, reapplication, versioning, and partial pre-existing fields
- FFRP versus non-FFRP default behavior
- arbitrary TaleSpire custom field discovery and registration
- HP and FP current/max pair transformation
- ambiguous aliases requiring confirmation
- character and game-entity parity
- source-authoritative, Prime-authoritative, and manual writes
- stale/replayed/out-of-order updates
- field deletion/rename after mapping
- linked game changes and cross-game mapping rejection
- migration of existing campaigns and mappings
- complete Discord-only setup without Symbiote schema editing

## Out of Scope

- Making HP or FP universal SPRITE fields
- Automatically syncing ad hoc per-record custom fields
- Replacing all existing table names in the first pass
- Automatic schema mutation merely because a source field was observed
- Bidirectional sync before an outbound adapter contract exists
- A universal public marketplace for game-system presets

## Definition of Done

- Prime has stable, game-owned field definitions with versioned preset support.
- FFRP HP/FP are preset fields, not core assumptions.
- Integrations can discover arbitrary source fields and map them to existing or newly registered Prime fields.
- Authority and provenance are explicit and enforced for character and game-entity writes.
- Fresh FFRP TaleSpire campaigns receive intended HP/FP source-authoritative defaults without affecting other game systems.
- Discord provides a complete management path; Symbiote UI support is optional convenience.
- Existing games, fields, mappings, and synced values migrate without silent loss or behavior changes.
