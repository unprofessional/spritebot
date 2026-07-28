# Custom Stat Definitions and Integration Sync

> **Status:** Proposed
> **Primary owner:** SPRITEbot-prime
> **Integration consumer:** SPRITE-Integrations
> **Initial adapter:** TaleSpire Symbiote
> **Product owner:** mads
> **Engineering:** Codex
> **Review:** Moldy
> **Last updated:** 2026-07-28

## Purpose

Treat every named game stat as a game-defined custom stat and make every custom stat independently configurable for integration sync.

SPRITE core does not define HP, FP, MP, Stress, Ammo, or any other named stat. Core defines only generic stat machinery: identity, value shape/type, validation, values, and integration-sync contracts. HP and FP are ordinary FFRP custom stats. An optional FFRP preset may create them for convenience, but they receive no special core storage, type, identity, or sync privilege.

This plan owns the custom-stat abstraction in SPRITEbot-prime because Prime owns games, custom-stat definitions, characters, entities, and canonical values. SPRITE-Integrations owns external-stat discovery, opt-in source-to-stat mappings, per-mapping sync configuration, and adapter-specific behavior. The TaleSpire Symbiote is a client of that generic contract. TaleSpire's native HP pair is merely one external source shape that can map to any compatible custom count stat.

## Current State

Prime already has most of the storage primitives:

- `stat_template` is the existing game-level custom-stat definition table shared by characters and game entities.
- `character_stat_field` and `game_entity_stat_field` hold canonical custom-stat values.
- `character_custom_field` and `game_entity_custom_field` hold freeform per-record metadata; despite their legacy names, they are not game stat definitions.
- Prime's Discord UI lets a GM create and edit custom stats through stat templates.

Integrations already has most of the TaleSpire bridge:

- The Symbiote reports native HP as `hp_current` and `hp_max` and reports arbitrary TaleSpire stats by name.
- `stat_template_mapping` maps observed TaleSpire names to Prime `stat_template` rows.
- Integrations can write mapped values into character and game-entity stat fields.
- The mapping review UI suggests HP pairs and name/alias matches, including FP aliases.

The missing pieces are stable custom-stat identity, explicit per-integration sync enablement and authority, integration-assisted custom-stat registration, reusable convenience presets, and provenance/conflict rules. Today the system can map TaleSpire stats only after the target Prime custom stat already exists, and HP-specific behavior still leaks into adapter code and notifications.

Known HP-privileged debt in Integrations includes `campaigns.hp_change_threshold`, `collectHpNotificationEvents`, the `character_down` event, `suggestHpMapping`, `isHpCurrent`/`isHpMax`/`isHpTemplate`, and HP/FP entries in `statAliases`. Implementation must convert these from stat-name-specific control flow into generic mapping, suggestion-profile, and notification-rule data.

## Terminology

### Custom stat definition

Every named stat used by a game is a custom stat. Examples include FFRP `hp` and `fp`, another game's `stress`, or a GM-created `meat_integrity`. This is the conceptual role already served by `stat_template`; no named stat exists above or outside this model.

A definition has:

- stable machine key
- display label
- value shape/type
- default value
- required/optional state
- sort order
- validation and presentation metadata

### Custom stat value

The canonical value of one custom stat on one character or game entity. Existing `character_stat_field` and `game_entity_stat_field` remain the storage model.

### Freeform custom field

Per-record metadata stored in the legacy `character_custom_field` and `game_entity_custom_field` tables. These may contain notes or one-off attributes, but they are not stats. A value intended to participate in stat display, validation, defaults, or sync must use a game-level custom-stat definition.

### External source stat

A stat exposed by an integration, identified by adapter and stable external key. Examples include TaleSpire `hp_current`, `hp_max`, `FP`, and `FP Max`. Native and user-created source stats have equal standing as mapping inputs.

### Sync mapping

A campaign- and integration-scoped rule connecting one or more external source stats to one Prime custom stat definition. The mapping is the opt-in sync configuration: if no enabled mapping exists for an integration, that custom stat is local-only for that integration.

### Authority policy

The per-mapping rule deciding which side may overwrite a canonical value. Authority is never an intrinsic property of HP, FP, or any other custom stat.

## Core Decisions

1. **SPRITE has no named core stats.** HP, FP, MP, Stress, Ammo, and every other named stat are game-defined custom stats.
2. **Prime remains canonical.** Custom-stat definitions and canonical values live in SPRITEbot-prime.
3. **`stat_template` is the custom-stat definition model.** Evolve it rather than creating a parallel custom-stat-definition system or an HP/FP-specific model.
4. **Every custom stat is independently sync-configurable per integration.** An enabled mapping opts that stat into sync for that integration; no mapping or a disabled mapping means local-only.
5. **Freeform per-record fields are not stats.** The legacy custom-field tables remain separate metadata storage and are not automatic sync targets.
6. **Stable keys replace label identity.** Integrations map to immutable custom-stat keys/IDs, never mutable display labels.
7. **Presets are convenience only.** FFRP may seed ordinary HP and FP custom stats. They remain editable and removable under the same rules as every other custom stat, and games without that preset receive no HP/FP assumptions.
8. **Authority is explicit per mapping.** It is not a property or privilege of a particular stat name. Initial FFRP TaleSpire mapping suggestions may default HP and FP to source-authoritative, subject to GM confirmation.
9. **Discovery is not registration or sync consent.** Observing a TaleSpire stat may suggest a custom stat and mapping, but it must not silently mutate Prime or enable sync.
10. **The first release remains inbound-only.** Do not claim bidirectional sync until a real Prime-to-adapter delivery path, loop prevention, and conflict tests exist.

## Proposed Data Model

### Prime: stable custom-stat identity

Extend `stat_template` with:

- `stat_key TEXT`
- a case-insensitive uniqueness constraint per active game, for example `UNIQUE (game_id, lower(stat_key))`
- optional structured validation/presentation data in the existing `meta` JSONB initially

Rules:

- `stat_key` is immutable after creation.
- Keys use a conservative normalized format such as `^[a-z][a-z0-9_]{0,63}$`.
- Labels remain editable and user-facing.
- New custom stats require a key; existing rows are backfilled deterministically from their labels with collision suffixes.
- API and integration contracts expose both the immutable stat ID and stat key.

Do not rename the table in the first implementation. A table rename adds migration risk without changing the product model. Application types and docs should use `CustomStatDefinition` while maintaining compatibility with `stat_template` storage.

The legacy `character_custom_field` and `game_entity_custom_field` tables are unrelated to this model. Do not add sync mappings, authority, or stat-definition behavior to them. They remain freeform per-record metadata; `stat_template` and its value tables are the custom-stat system.

### Prime: presets

Define versioned game-system presets in application code first, not as mutable global database rows.

Example FFRP preset:

```ts
{
  key: 'ffrp',
  version: 1,
  stats: [
    {
      statKey: 'hp',
      label: 'HP',
      fieldType: 'count',
      required: true,
      defaultValue: '0/0'
    },
    {
      statKey: 'fp',
      label: 'FP',
      fieldType: 'count',
      required: true,
      defaultValue: '0/0'
    }
  ]
}
```

Persist the selected preset key/version on `game` so setup is reproducible and future migrations can distinguish seeded custom stats from hand-created custom stats. Applying a preset is additive and idempotent by `stat_key`; it never deletes or overwrites a GM-customized stat without confirmation. After creation, preset-seeded and hand-created stats use the same model and capabilities.

### Integrations: external source-stat registry

Add a campaign-scoped registry of observed external source stats. A source descriptor should include:

- integration key, initially `talespire`
- stable source key
- display label
- observed value shape/type
- optional grouping metadata such as current/max pair membership
- first/last observed timestamps
- adapter metadata

For TaleSpire, use stable normalized source keys while retaining the raw display name. TaleSpire's native HP source should remain an explicit count pair (`hp_current`, `hp_max`), described through the same source-shape metadata used for any other current/max pair. User-created TaleSpire stats should receive deterministic normalized keys and retain their original names for display and troubleshooting.

### Integrations: generalized mapping

Evolve `stat_template_mapping` rather than creating a second TaleSpire-only mapping system. Add or clarify:

- `integration_key`
- target Prime custom-stat key/ID
- external source-stat key(s)
- transformation type and options
- authority policy
- enabled/disabled state
- optional generic notification rules, such as change threshold or minimum-value event
- creation/update actor and timestamps

Initial authority policies:

- `source_authoritative`: accepted external updates overwrite the canonical Prime value.
- `prime_authoritative`: inbound updates are observed but do not overwrite Prime.
- `manual`: no automatic write until the mapping is reviewed/enabled.

Do not add a global `syncable` flag to `stat_template`: sync configuration is per custom stat, campaign, and integration. One custom stat may be local-only for TaleSpire while mapped to another future integration. An enabled mapping is the opt-in; disabling or deleting that mapping returns the stat to local-only for that integration.

Reserve bidirectional behavior for a later phase. Do not add a nominal `bidirectional` option that cannot actually deliver outbound changes.

### Prime values: provenance

Record enough provenance on successful integration writes to explain the current value and reject stale updates:

- integration key
- source campaign and external stat key
- source observation timestamp or monotonic revision when available
- mapping ID/version
- last writer

The existing value-row `meta` JSONB can hold provenance initially. Add a real `updated_at` column to both canonical value tables if needed for deterministic ordering and diagnostics.

The write contract must reject or no-op:

- a source write against a Prime-authoritative/manual mapping
- a stale observation older than the accepted source revision/timestamp
- a mapping whose target custom stat no longer belongs to the linked game
- a value that fails the target custom stat's validation

## Registration and Mapping UX

### Prime Discord UI

Extend the existing stat-template UI and present it consistently as custom-stat setup.

Required flows:

- create any custom stat manually with stable key, label, type, and defaults
- optionally select and preview a game-system preset when creating or editing a game
- show per integration whether each custom stat is local-only, mapped/enabled, or mapped/disabled
- show the source mapping and authority for every synced custom stat
- enable, disable, remap, or remove sync independently for each custom stat
- prevent destructive stat deletion while active mappings exist, or require mappings to be removed first
- optionally convert a legacy freeform field into a custom stat, with explicit value migration choices

### Integrations Discord UI

Extend the existing mapping review UI:

- show every Prime custom stat and whether it is sync-enabled for TaleSpire
- show observed native and user-created TaleSpire source stats without treating native HP as canonical
- map one or more compatible source stats to an existing custom stat
- offer `Create custom stat and map` when no target exists
- require explicit confirmation before creating the Prime custom stat or enabling sync
- enable/disable sync and choose authority independently per mapping
- default newly accepted mappings to `source_authoritative`, while making the choice visible
- show local-only, stale, invalid, disabled, or target-missing mappings

Custom-stat creation initiated from Integrations must use the same Prime-owned validation and idempotency rules as Prime UI. While the direct database bridge remains, implement one narrowly scoped Prime custom-stat registration DAO/service contract and test it against Prime schema. Longer term, route this through a service API rather than unrestricted cross-database writes.

### Symbiote UI

Treat Symbiote-side registration as a later convenience layer, not a prerequisite for the model.

Feasibility/design phase:

- expose observed TaleSpire source descriptors in the Symbiote
- fetch the campaign's Prime custom-stat definitions and current mappings through the scoped campaign API
- let a GM propose or select mappings
- send mapping requests to Integrations for validation and persistence
- never expose direct Prime database access or service-wide credentials

If the Symbiote API/UI constraints make safe schema editing awkward, keep schema creation in Discord and use the Symbiote for discovery/status only. The core contract must not depend on Symbiote UI support.

## FFRP and TaleSpire Defaults

When an Integrations campaign links to a Prime game using the optional FFRP preset:

1. The preset creates ordinary `hp` and `fp` custom-stat definitions using the same storage and rules as GM-created stats.
2. If TaleSpire native HP stats are observed and no conflicting mapping exists, suggest:
   - `hp_current` + `hp_max` -> FFRP's `hp` custom stat
   - transformation: `count_pair`
   - authority: `source_authoritative`
3. If TaleSpire `FP` and `FP Max` (or an unambiguous equivalent pair) are observed, suggest:
   - current + max source pair -> FFRP's `fp` custom stat
   - transformation: `count_pair`
   - authority: `source_authoritative`
4. Require GM confirmation before enabling either mapping. The preset may supply suggestions and defaults, not silent sync consent.
5. Do not guess ambiguous FP aliases such as `focus` versus `fatigue` without confirmation unless the selected preset explicitly defines the alias.
6. Never create or map HP/FP for non-FFRP games merely because similarly named TaleSpire stats exist. Offer them through the same generic discovery/mapping UI as every other source stat.

HP and FP receive no special runtime treatment after setup. They are ordinary custom count stats with ordinary mappings. TaleSpire's native HP shape may improve the mapping suggestion, but it does not make `hp` a Prime core stat or grant it unique sync behavior.

## Write Path and Enforcement

Centralize mapped writes through one integration-write service in SPRITE-Integrations. Both player characters and game entities must use the same resolution, transformation, validation, authority, provenance, and stale-update logic.

The service flow:

1. Resolve campaign, linked Prime game, and target character/entity.
2. Load enabled mappings for the integration campaign.
3. Resolve the target custom stat by immutable ID/key and verify game ownership.
4. Confirm that this exact mapping is enabled; otherwise leave the stat local-only.
5. Transform source values into the target shape.
6. Enforce authority and stale-update policy.
7. Validate the result against the Prime custom-stat definition.
8. Upsert the canonical value and provenance atomically.
9. Return per-stat written/skipped/error diagnostics.

Any notification feature must resolve its configured custom stat through the generic mapping contract rather than assuming a Prime `hp` stat exists. An FFRP HP-change notification can default to the preset's `hp` key, but the notification engine must accept any compatible custom stat and remain disabled when none is configured.

## Delivery Phases

### Phase 1: Prime custom-stat identity and optional presets

**Repo:** `spritebot`

- Establish in code and UI that `stat_template` is the custom-stat definition model and that Prime has no named core stats.
- Add/backfill immutable `stat_key` on `stat_template`.
- Add uniqueness and validation constraints.
- Introduce application-level `CustomStatDefinition` terminology/types without a risky table rename.
- Add selected preset key/version to games.
- Implement an idempotent convenience-preset service and FFRP v1 with ordinary HP/FP count stats.
- Add Prime UI for stable-key manual stat creation and optional preset application.
- Keep seeded stats editable/removable under the same rules as manually created custom stats.
- Add migration, DAO/service, UI, and regression tests.

**Gate:** Existing games and templates retain all values; every named stat uses the same custom-stat model; an FFRP preset can add HP/FP once without making either a core or privileged stat.

### Phase 2: External-stat registry and opt-in mapping contract

**Repo:** `spritebot-integrations`

- Persist normalized descriptors for both native and user-created TaleSpire source stats.
- Generalize mappings with integration key, stable source keys, target custom-stat identity, transformation, authority, enabled state, and audit metadata.
- Make mapping presence plus enabled state the only way a custom stat becomes syncable for an integration.
- Migrate existing mapping rows without changing current write behavior.
- Update mapping review/status output to show local-only, mapped/enabled, and mapped/disabled states.
- Add tests proving arbitrary custom stats receive the same sync options as HP/FP.

**Gate:** Existing TaleSpire campaigns continue syncing; every observed source stat has stable identity; every Prime custom stat can independently opt into or out of TaleSpire sync.

### Phase 3: Integration-assisted registration

**Repos:** `spritebot` contract first, then `spritebot-integrations` consumer

- Define Prime-owned create/list custom-stat operations and validation rules.
- Add `Create custom stat and map` to Integrations mapping review.
- Require explicit confirmation for both custom-stat creation and sync enablement.
- Make creation plus mapping idempotent and transactional where possible.
- Prevent cross-game targets and unauthorized schema changes.
- Add contract tests in both repos.

**Gate:** A GM can map any compatible TaleSpire source stat even when no Prime custom stat exists, without leaving setup, and can leave any Prime custom stat local-only.

### Phase 4: Authority and provenance enforcement

**Repo:** `spritebot-integrations`, with Prime schema support

- Centralize character/entity write-through.
- Enforce source-authoritative, Prime-authoritative, and manual policies.
- Persist provenance and reject stale source observations.
- Replace `collectHpNotificationEvents` with a generic mapped-stat notification evaluator.
- Move `campaigns.hp_change_threshold` behavior into optional per-mapping notification rules so any compatible custom stat can drive change/minimum alerts.
- Replace the internal HP-only `character_down` assumption with a generic minimum-value event; FFRP presentation may still render that configured event as “character down.”
- Add parity tests across HP, FP, renamed stats, and arbitrary custom stat names.
- Add replay, out-of-order, disabled mapping, deleted target, validation, and conflict tests.

**Gate:** Source-authoritative custom stats update deterministically; Prime/manual/local-only stats cannot be overwritten by inbound sync; diagnostics explain every skipped write without stat-name-specific logic.

### Phase 5: FFRP TaleSpire defaults

**Repo:** `spritebot-integrations`

- Detect the linked Prime game's optional FFRP preset/version.
- Replace `suggestHpMapping`, `isHpCurrent`/`isHpMax`/`isHpTemplate`, and hard-coded `statAliases` branching with generic source-shape matching plus data-driven preset/adapter suggestion profiles.
- Represent HP and FP aliases as suggestion data, not runtime control flow.
- Suggest HP and FP count-pair mappings through the same generic mapper used by every custom stat.
- Present TaleSpire/source authority as the visible default for those suggestions.
- Require GM confirmation before enabling sync.
- Preserve explicit GM mappings and never overwrite them during reseeding.
- Add FFRP, non-FFRP, renamed-stat, deleted-stat, and arbitrary-stat acceptance tests.

**Gate:** A fresh FFRP setup can confirm intended HP/FP mappings quickly, while HP/FP remain ordinary custom stats and non-FFRP games receive no hidden schema, mappings, or authority decisions.

### Phase 6: Symbiote mapping UI feasibility and optional implementation

**Repo:** `spritebot-integrations/symbiote`

- Verify TaleSpire Symbiote API/UI constraints.
- Add source discovery and mapping status.
- If safe and usable, add mapping proposal/registration through scoped Integrations endpoints.
- Keep Discord as the complete fallback path.

**Gate:** Symbiote UI can improve setup but is not required to define stats, recover mappings, or administer authority.

### Phase 7: Outbound/bidirectional research

**Repos:** cross-repo design only until approved

- Inventory TaleSpire APIs/events that can accept writes.
- Specify revisions, loop prevention, retries, and conflict resolution.
- Decide whether any stat truly needs bidirectional behavior.
- Do not implement or expose bidirectional authority until the design is proven.

## Migration and Compatibility

- Backfill stable keys without changing template IDs, labels, or stat values.
- Migrate all existing Integrations mapping rows with `enabled = true` and `authority = 'source_authoritative'`, exactly matching today's write-through behavior, then flag them for authority review in setup status.
- Treat existing unmapped custom stats as local-only; do not auto-enable sync based on their names.
- Migrate each existing `hp_change_threshold` to a generic notification rule only when its target mapping is unambiguous; otherwise retain a compatibility fallback and prompt the GM to choose a custom stat rather than guessing.
- Do not automatically classify existing games as FFRP based only on HP/FP labels.
- Offer an explicit `Apply FFRP preset` action that reuses matching unambiguous custom stats or asks before collisions.
- Preserve existing freeform custom fields untouched and continue treating them as non-stat metadata.
- Keep current TaleSpire raw-stat caches for diagnostics and replay while canonical writes move to the generalized contract.
- Roll out schema changes additively before application code depends on them.

## Security and Permissions

- Only the Prime game owner or an explicitly authorized GM/admin may create definitions or change authority.
- Symbiote requests use campaign-scoped credentials, not the deployment-wide webhook secret targeted for replacement in the TaleSpire launch plan.
- All registration and authority changes record actor, timestamp, and old/new state.
- Integration source metadata is untrusted input: normalize keys, cap lengths, validate types, and never use source labels as SQL identifiers.
- A campaign cannot map to a custom stat outside its linked Prime game.

## Test Matrix

At minimum, cover:

- stable-key backfill with duplicate/case-colliding labels
- preset application, reapplication, versioning, and partial pre-existing stats
- seeded versus manually created stat parity
- FFRP versus non-FFRP default behavior
- arbitrary native and user-created TaleSpire source-stat discovery
- arbitrary Prime custom-stat registration and mapping
- independent enable/disable and authority settings for every custom stat
- local-only custom stats remaining untouched by sync
- generic notification rules on HP, renamed HP, FP, and unrelated count stats
- migration of `hp_change_threshold` and `character_down` behavior without retaining HP-only control flow
- HP and FP current/max pair transformation with no privileged runtime path
- renamed HP/FP and unrelated count stats behaving identically
- ambiguous aliases requiring confirmation
- character and game-entity parity
- source-authoritative, Prime-authoritative, and manual writes
- stale/replayed/out-of-order updates
- custom-stat deletion/rename after mapping
- linked game changes and cross-game mapping rejection
- migration of existing campaigns and mappings
- complete Discord-only setup without Symbiote schema editing

## Out of Scope

- Defining any named stat, including HP or FP, in SPRITE core
- Treating legacy freeform custom fields as game stats or automatic sync targets
- Replacing all existing table names in the first pass
- Automatic schema mutation or sync enablement merely because a source stat was observed
- Bidirectional sync before an outbound adapter contract exists
- A universal public marketplace for game-system presets

## Definition of Done

- Prime has one stable game-defined custom-stat model and no named core stats.
- Every custom stat can independently be local-only or mapped per integration, with explicit enabled state and authority.
- FFRP HP/FP are ordinary optional preset-created custom stats, not core assumptions or privileged sync cases.
- Integrations can discover arbitrary source stats and map them to any compatible existing or newly registered Prime custom stat.
- Native TaleSpire HP uses the same mapping, transformation, authority, provenance, and write path as every other source stat.
- Authority and provenance are explicit and enforced for character and game-entity writes.
- Fresh FFRP TaleSpire campaigns can confirm convenient HP/FP suggestions without affecting other game systems.
- Discord provides a complete management path; Symbiote UI support is optional convenience.
- Existing games, custom stats, mappings, and synced values migrate without silent loss or behavior changes.
