# Plan: Game-Owned NPCs and Creatures

> **Status:** Ready for product review
> **Owner:** mads
> **Engineering:** Codex
> **Review:** Moldy
> **Related plan:** [TaleSpire product and delivery gaps](tale-spire-gaps.md)

## Goal

Add NPCs and creatures to SPRITE as game-owned records using the existing character model as the implementation template.

This is an additive sibling model, not a character migration or a generalized actor-system rewrite. Existing player characters and every current `character_id` foreign key remain unchanged.

## Product Shape

NPCs and creatures have the same storage shape and behavior for this first release. One table stores both kinds, distinguished by a constrained `kind` column:

- `npc`
- `creature`

They belong to a game rather than a Discord player. Existing game-management authorization determines who may create, edit, delete, restore, or reveal them. `created_by` records the Discord user who created the record for audit purposes; it does not create a separate ownership model.

The first release copies the useful character capabilities:

- name, avatar, roleplay display name/avatar, and bio
- game-defined stat fields
- custom fields
- inventory and inventory custom fields
- existing `private`, `public`, and `link-only` visibility values
- 30-day soft delete and restore behavior

The first release does **not** include:

- migration or conversion of existing player characters
- player assignment or ownership of NPCs/creatures
- active-character replacement or roleplay proxy selection
- TaleSpire import/linking
- provider-neutral adapter abstractions
- changes to existing character tables, DAOs, services, or foreign keys unless required to share a pure presentation helper

TaleSpire linking remains a separate follow-up after the base SPRITE feature is complete.

## Proposed ERD

```text
EXISTING, UNCHANGED

┌──────────────────────┐
│ game                 │
│ PK id                │
│    guild_id          │
│    created_by        │
└──────────┬───────────┘
           │ 1
           ├──────────────────────────────┐
           │ N                            │ N
┌──────────▼───────────┐       ┌──────────▼───────────┐
│ character            │       │ stat_template        │
│ PK id                │       │ PK id                │
│ FK game_id           │       │ FK game_id           │
│    user_id           │       │    label/type/etc    │
│    name/avatar/etc   │       └──────────────────────┘
└──────────┬───────────┘
           │
           ├──< character_stat_field >── stat_template
           ├──< character_custom_field
           └──< character_inventory ──< character_inventory_field

NEW, ADDITIVE

┌────────────────────────────┐
│ game_entity                │
│ PK id                      │
│ FK game_id                 │──────> game.id
│    created_by              │
│    kind                    │        npc | creature
│    name/avatar/etc         │
│    visibility              │
│    soft-delete timestamps  │
└─────────────┬──────────────┘
              │ 1
       ┌──────┼──────────────────┐
       │ N    │ N                │ N
┌──────▼────┐ ┌▼──────────────┐  ┌▼────────────────────┐
│game_entity│ │game_entity_   │  │game_entity_inventory│
│_stat_field│ │custom_field   │  │PK id                │
│FK entity  │ │FK entity      │  │FK game_entity_id    │
│FK template│ │name/value     │  │item fields          │
└───────────┘ └───────────────┘  └──────────┬───────────┘
                                             │ 1
                                             │ N
                                  ┌──────────▼────────────┐
                                  │game_entity_inventory_│
                                  │field                 │
                                  │FK inventory_id       │
                                  └───────────────────────┘
```

## Database Migration

Add `src/db/tables/011_game_entities.sql` and update the canonical `tables.sql`. The migration creates five tables and supporting indexes. It performs no `ALTER TABLE` against existing character tables and no data backfill.

### `game_entity`

```sql
CREATE TABLE game_entity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('npc', 'creature')),
  name TEXT NOT NULL,
  avatar_url TEXT,
  rp_display_name TEXT,
  rp_display_avatar_url TEXT,
  bio TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public', 'link-only')),
  deleted_at TIMESTAMP,
  deleted_by_game BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX game_entity_active_game_idx
  ON game_entity (game_id, kind, created_at)
  WHERE deleted_at IS NULL;
```

### `game_entity_stat_field`

Copy `character_stat_field`, replacing `character_id` with `game_entity_id`:

```sql
CREATE TABLE game_entity_stat_field (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_entity_id UUID NOT NULL REFERENCES game_entity(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES stat_template(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  meta JSONB DEFAULT '{}',
  UNIQUE (game_entity_id, template_id)
);
```

### `game_entity_custom_field`

Copy `character_custom_field`, replacing `character_id` with `game_entity_id`:

```sql
CREATE TABLE game_entity_custom_field (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_entity_id UUID NOT NULL REFERENCES game_entity(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  meta JSONB DEFAULT '{}',
  UNIQUE (game_entity_id, name)
);
```

### `game_entity_inventory`

Copy `character_inventory`, replacing `character_id` with `game_entity_id`:

```sql
CREATE TABLE game_entity_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_entity_id UUID NOT NULL REFERENCES game_entity(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  equipped BOOLEAN DEFAULT FALSE,
  description TEXT
);
```

### `game_entity_inventory_field`

Copy `character_inventory_field`, pointing at `game_entity_inventory`:

```sql
CREATE TABLE game_entity_inventory_field (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID NOT NULL REFERENCES game_entity_inventory(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  meta JSONB DEFAULT '{}',
  UNIQUE (inventory_id, name)
);
```

### Deployment and rollback

- Existing rows are not transformed.
- Existing application versions ignore the new tables.
- Game deletion cascades to entities and their child rows through foreign keys.
- Rollback before public use may drop the five new tables in dependency order.
- Once users create entities, rollback must preserve/export their rows rather than silently dropping them.

## Implementation Phases

### Phase 1: Schema, types, and DAOs

- [x] Add the five tables to `011_game_entities.sql` and `src/db/tables/tables.sql`.
- [x] Add all five names to the tracked-table inventory in `src/db/db.ts` so incomplete fresh schemas are reported correctly.
- [x] Add `GameEntityKind`, `GameEntity`, hydrated stat/custom-field, and inventory types.
- [x] Add `GameEntityDAO` by following `CharacterDAO` patterns for create, get, list-by-game, update metadata, soft delete, restore, and permanent cleanup.
- [x] Add entity stat-field, custom-field, inventory, and inventory-field DAOs by following their character equivalents.
- [x] Reject creation for deleted or nonexistent games.
- [x] Add PGlite integration tests for constraints, cascades, CRUD, soft deletion, restoration, and child-table uniqueness.

### Phase 2: Services and authorization

- [ ] Add a `game_entity.service.ts` orchestration layer matching character hydration behavior.
- [ ] Reuse the current game-management authorization path; do not invent entity-specific roles or ownership.
- [ ] Enforce that the entity, stat template, and inventory operations all belong to the same active game.
- [ ] Implement create, edit, list, view, soft delete, restore, stat/custom-field updates, and inventory operations.
- [ ] Restore entities as `private`, matching character restore safety behavior.
- [ ] Add service tests for authorization, cross-game rejection, deleted-game rejection, and hydration.

### Phase 3: Discord UX

Use the existing character commands and components as copy-and-adapt references while keeping entity custom IDs and handlers separate.

Proposed command surface:

- `/create-entity kind:<npc|creature>`
- `/list-entities [kind:<npc|creature>]`
- `/view-entity`
- `/restore-entity`

The view card supplies edit, visibility, inventory, and delete controls for authorized game managers.

- [ ] Register the commands and feature-policy mappings.
- [ ] Add autocomplete/select menus scoped to the current game and optional entity kind.
- [ ] Copy character draft/edit/stat/inventory interaction patterns where useful.
- [ ] Display `NPC` or `Creature` clearly on cards and selection options.
- [ ] Hide deleted entities from normal lists and autocomplete.
- [ ] Keep private/link-only entities off public surfaces using the same rules as characters.
- [ ] Add `/help` entries and concise GM onboarding copy.

### Phase 4: Lifecycle and regression validation

- [ ] Extend game soft-delete/restore accounting to include game entities.
- [ ] Ensure game deletion marks or removes entities consistently with characters and restores them safely within the same 30-day window.
- [ ] Add command/component tests for GM access, non-GM denial, visibility, delete confirmation, and restore.
- [ ] Add regression tests proving existing character creation, selection, roleplay proxying, deletion, and restoration are unchanged.
- [ ] Run formatting, lint, full tests, build, and Discord boundary/policy checks.
- [ ] Validate the feature in a real game before beginning TaleSpire linking.

## Follow-Up: TaleSpire Linking

Do not include this in the base feature branch.

After game entities ship, SPRITE-Integrations may add a nullable `spritebot_entity_id` to its own creature mapping/cache records. Because SPRITE and SPRITE-Integrations use separate database boundaries, this is a logical UUID reference rather than a cross-database foreign key.

A GM explicitly promotes or links a cached TaleSpire creature to a SPRITE `game_entity`. Unlinked cache rows remain integration-local and do not create base-app records automatically.

## Acceptance Criteria

- A game manager can create either an NPC or creature in an active game.
- Both kinds share one schema, DAO/service path, and Discord interaction flow.
- Entities support game stat templates, custom fields, inventory, visibility, soft deletion, and restoration.
- Normal players cannot create, edit, delete, restore, or discover private game entities through restricted surfaces.
- Deleting a game handles its entities consistently with player characters.
- Existing player-character tables, rows, foreign keys, commands, and behavior remain unchanged.
- No TaleSpire-specific fields or abstractions are added to SPRITEbot in this plan.
- All lint, test, build, Discord boundary, and feature-policy checks pass.
