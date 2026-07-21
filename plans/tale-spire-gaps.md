# TaleSpire Product & Delivery Gaps

> **Status:** Active planning
> **Owner:** mads
> **Engineering:** Codex
> **Review:** Moldy
> **Related repos:** `spritebot`, `spritebot-integrations`, `spriteweb`
> **Last updated:** 2026-07-21

## Purpose

Track the remaining product, onboarding, distribution, and data-model work required before the TaleSpire integration can be marketed as a clean self-service SPRITE feature.

The sync bridge and Premium entitlement enforcement exist. The remaining gaps are not primarily about stat transport; they are about selling the right plan, installing a second Discord app cleanly, safely delivering the Symbiote, and representing non-player TaleSpire entities in SPRITE.

## Current State

- TaleSpire access is bundled into the existing Premium SKU through `integrations:talespire`.
- SPRITE-Integrations can enforce SPRITE entitlements through its read-only connection to the SPRITE database.
- The Symbiote source exists under `spritebot-integrations/symbiote/` and can be installed manually.
- SPRITE-Integrations already caches TaleSpire campaign creatures in `campaign_creatures` and maps selected creatures to integration `characters`.
- SPRITE's canonical character model is still player-character-oriented and does not model general NPCs or creatures.
- Public onboarding still assumes that an operator can hand the GM an integration-bot invite, a Symbiote folder, a webhook URL, a shared webhook secret, and setup instructions.

That operator-assisted path is acceptable for testers, but not for a marketed product.

---

## Gap 1 — Pro Plan Does Not Exist Yet

### Why this matters

The code has a `pro:transcription` feature key, but there is no purchasable Pro SKU. This creates a product-positioning gap if TaleSpire marketing is meant to lead into a combined higher-value SPRITE offering.

TaleSpire itself is currently included in Premium. Pro is therefore **not a technical blocker for TaleSpire launch** unless the product decision changes. It is a commercial/catalog blocker for any marketing that promises a complete Premium + transcription package.

### Product decisions — mads

- [ ] Confirm that TaleSpire remains in Premium rather than moving to Pro.
- [ ] Define the Pro bundle. Recommended baseline: every Premium feature plus `pro:transcription`.
- [ ] Set the Pro monthly price and confirm whether Discord supports every desired billing interval.
- [ ] Define any transcription usage policy, fair-use language, or hard limits.
- [ ] Create and publish the Pro SKU in the Discord Developer Portal.
- [ ] Provide the final SKU ID, store description, price, and launch date to engineering.

### Engineering tasks — Codex

- [ ] Add the Pro SKU to `src/services/plans.ts`, mapping it to the full Premium bundle plus `pro:transcription`.
- [ ] Add tests proving Premium and Pro resolve to the expected feature sets and that Pro is a superset of Premium.
- [ ] Update `/subscribe`, `/help`, and plan/status displays to distinguish Premium from Pro.
- [ ] Update `spriteweb` pricing and feature-comparison copy after mads confirms the product decisions.
- [ ] Add an entitlement transition test for Premium → Pro, Pro → Premium, cancellation-forward, and revocation.

### Acceptance criteria

- A guild can purchase Pro through Discord.
- Pro grants all Premium features, TaleSpire access, and transcription.
- Premium continues to grant TaleSpire access without transcription.
- Subscription UX and public pricing describe both plans consistently.

---

## Gap 2 — No Clean Way to Pull In SPRITE-Integrations

### Why this matters

The user currently has to understand that TaleSpire support is a second Discord application and obtain/install it separately. SPRITE does not guide an entitled GM through that transition, detect incomplete setup, or provide one coherent setup status.

### Recommended product flow

Keep SPRITE-Integrations as a separate operational app, but make the separation feel like an implementation detail:

1. An entitled admin runs `/talespire setup` in SPRITE.
2. SPRITE checks the guild's entitlement and whether SPRITE-Integrations is installed.
3. If missing, SPRITE presents the official install link and required permissions.
4. Once installed, the GM receives a short guided checklist for campaign creation, scoped connection credentials, Symbiote download, and verification.
5. `/talespire status` reports the state across both apps: entitlement, app installed, campaign configured, Symbiote connected, and mappings healthy.

Discord may not permit a fully automatic second-app installation. "Clean pull-in" therefore means a guided, resumable handoff with one authoritative status surface—not hiding a required OAuth consent screen.

### Product / platform tasks — mads

- [ ] Confirm that SPRITE-Integrations remains a separate Discord application for the public launch.
- [ ] Review and minimize its requested bot permissions and OAuth scopes.
- [ ] Configure a canonical install URL and verify installation in a clean test guild.
- [ ] Decide the public naming: whether users see "SPRITE-Integrations," "SPRITE TaleSpire," or another product-facing name.
- [ ] Decide whether setup begins in SPRITE, on `sprite.devcru.org`, or both. Recommendation: both paths converge on the same setup state.
- [ ] Decide who may initiate setup: guild owner only, members with Manage Server, or a narrower role policy.

### Engineering tasks — Codex

- [ ] Add configuration for the integration app ID, install URL, and expected permissions.
- [ ] Add a Premium-gated `/talespire setup` command to SPRITE.
- [ ] Detect whether the integration bot is present in the guild and render the correct next step.
- [ ] Add `/talespire status` in SPRITE, backed by a narrow status contract rather than broad cross-service database access.
- [ ] Add a resumable setup state/checklist so users can leave and return without starting over.
- [ ] Add clear failure states for missing entitlement, missing integration app, missing campaign, missing Symbiote connection, and unhealthy mappings.
- [ ] Add integration/contract tests for fresh install, partial setup, completed setup, lost entitlement, and removed integration app.
- [ ] Update help/onboarding copy and link to the canonical setup guide.

### Acceptance criteria

- A new Premium guild can discover TaleSpire setup from SPRITE without contacting an operator.
- The GM is guided through the second app's required Discord consent step.
- Setup is resumable and reports exactly what remains incomplete.
- Removing SPRITE-Integrations or losing entitlement produces a useful recovery path.

---

## Gap 3 — No User-Ready Symbiote Bundle or Delivery Path

### Why this matters

The Symbiote exists as source files, but users need a versioned, tested, downloadable artifact and a safe configuration flow. Handing users a repository folder and a shared deployment-wide webhook secret is not a public distribution strategy.

### Security prerequisite

The current guide asks the GM to enter `SPRITE_INTEGRATIONS_WEBHOOK_SECRET`. A deployment-wide shared secret must not be included in a public bundle or manually distributed to customers.

Before public delivery, replace it with a revocable credential scoped to one guild/campaign (or an equivalent signed provisioning flow). A leaked campaign credential must not authorize syncs for every customer.

### Product / release tasks — mads

- [ ] Choose the canonical distribution channel:
  - hosted download on `sprite.devcru.org`,
  - GitHub Releases,
  - TaleSpire/Symbiote directory,
  - or a combination with one canonical source.
- [ ] Confirm directory submission requirements and whether BouncyRock review is required.
- [ ] Decide the supported update policy: manual download, update notification, or in-client updater.
- [ ] Approve the campaign credential lifecycle: issue, display once, rotate, revoke, and recover.
- [ ] Approve the public setup guide and support boundary.

### Engineering tasks — Codex

#### Packaging and release

- [ ] Add a deterministic build/package command that emits a ZIP containing only the required Symbiote files.
- [ ] Add a version to the manifest and expose it in the Symbiote UI/status payload.
- [ ] Validate the bundle in CI: required files, valid manifest, no secrets, no development-only URLs, and reproducible contents.
- [ ] Publish the ZIP and checksum through the selected release channel.
- [ ] Add a stable download URL consumed by SPRITE's setup flow and `spriteweb`.

#### Scoped provisioning

- [ ] Design and implement per-campaign install credentials or signed provisioning tokens.
- [ ] Store only hashed/revocable token material where practical.
- [ ] Bind credentials to the intended guild and campaign.
- [ ] Add rotate/revoke commands and audit metadata.
- [ ] Reject a valid token used against the wrong campaign.
- [ ] Remove the deployment-wide webhook secret from all public setup instructions.

#### User experience

- [ ] Reduce manual configuration to the smallest practical set; ideally the GM pastes one setup token or opens a generated configuration link.
- [ ] Add bundle-version compatibility reporting to `/talespire status`.
- [ ] Provide actionable messages for outdated bundles, revoked credentials, and unreachable endpoints.
- [ ] Add an end-to-end test from generated artifact/configuration through successful campaign sync.

### Acceptance criteria

- A GM can download one clearly versioned Symbiote ZIP from an official location.
- The artifact contains no service-wide secret.
- Setup credentials are scoped, revocable, and cannot cross guild/campaign boundaries.
- The system can identify outdated or incompatible Symbiote versions.
- A clean-machine install can be completed from public documentation alone.

---

## Gap 4 — Creatures and NPCs Are Not Canonical SPRITE Entities

### Why this matters

SPRITE-Integrations can observe and cache TaleSpire creatures, but SPRITE's canonical database is centered on player-owned characters. NPCs and general creatures need different ownership, editing, discovery, and visibility semantics.

This is more than adding nullable `user_id`. We need to decide which entities belong in SPRITE, who controls them, what players can see, and whether visibility applies to the entity, individual stats, or both.

### Existing pieces to preserve

- `spritebot-integrations.campaign_creatures` is an operational TaleSpire roster/cache, not necessarily the canonical product model.
- SPRITE characters already support `private`, `public`, and `link-only` visibility.
- TaleSpire creature-to-SPRITE character links and stat write-through already exist for player characters.

### Product decisions — mads

- [ ] Define the supported entity types. Proposed starting set: player character, NPC, and creature.
- [ ] Define ownership/control:
  - player characters: owned by a Discord user;
  - NPCs/creatures: controlled by the GM/game admins, optionally assignable later.
- [ ] Define entity visibility. Proposed starting set:
  - `gm-only` — hidden from normal players;
  - `game` — visible to members of the game;
  - `public` — eligible for public/link surfaces.
- [ ] Decide whether stat-level visibility is required at launch. Recommendation: support entity-level visibility first, but design the schema so hidden stat fields can be added without replacing the entity model.
- [ ] Define defaults. Recommendation: imported NPCs/creatures default to `gm-only` and require an explicit reveal.
- [ ] Decide whether every observed TaleSpire creature becomes canonical automatically or only after a GM imports/promotes it. Recommendation: cache everything, promote explicitly.
- [ ] Decide behavior when an entity disappears from TaleSpire, changes boards, loses Unique status, or is deleted.

### Engineering tasks — Codex

#### Design spike — do before implementation

- [ ] Audit every assumption that a SPRITE `character` has a player owner.
- [ ] Compare two schema strategies:
  1. generalize the existing character model into an actor/entity model;
  2. add a separate game-entity model for NPCs/creatures.
- [ ] Document migration risk, command impact, inventory/stat reuse, and compatibility with existing character URLs.
- [ ] Recommend one strategy with an explicit data migration and rollback plan.

#### Implementation after design approval

- [ ] Add the approved canonical entity schema, type discriminator, control policy, and visibility model.
- [ ] Add DAOs/services with guild/game authorization boundaries.
- [ ] Add GM commands/components to import/promote TaleSpire creatures, edit type, and toggle visibility.
- [ ] Keep unpromoted TaleSpire roster entries in the integration cache only.
- [ ] Extend TaleSpire linking and write-through to canonical NPCs/creatures.
- [ ] Ensure hidden entities never appear in player autocomplete, party views, public lists, notifications, or links.
- [ ] Add explicit reveal/hide audit events or logs.
- [ ] Add deletion, unlink, stale-link, and re-import behavior.
- [ ] Add migration, authorization, and visibility-leak tests.

### Acceptance criteria

- A GM can promote an observed TaleSpire creature into a canonical SPRITE NPC/creature.
- NPCs/creatures do not require a Discord-user owner.
- New imports default to the safest visibility.
- Visibility is enforced consistently across commands, autocomplete, notifications, API/web surfaces, and integrations.
- Existing player characters continue working without migration-visible regressions.

---

## Recommended Sequencing

### Track A — Public TaleSpire onboarding (launch blocker)

1. Decide the second-app setup flow and public product name.
2. Replace the shared webhook secret with scoped campaign provisioning.
3. Build SPRITE's guided `/talespire setup` and status handoff.
4. Package and publish the versioned Symbiote artifact.
5. Validate the complete clean-guild/clean-machine journey.

### Track B — Canonical creatures and NPCs

1. Resolve product decisions for entity types, control, and visibility.
2. Run the schema/design spike.
3. Implement canonical entities and safe visibility defaults.
4. Extend TaleSpire promotion, linking, and write-through.

Track B can begin in parallel, but it should not destabilize the Track A onboarding launch. The initial public integration may remain player-character-focused if that limitation is stated clearly.

### Track C — Pro commercialization

1. mads defines and creates the Pro SKU.
2. Codex wires the SKU and subscription UX.
3. Update public pricing and launch copy.

This track is independent of TaleSpire while TaleSpire remains a Premium feature.

---

## Immediate Action Queue

### mads

1. [ ] Confirm TaleSpire stays in Premium and define what Pro adds.
2. [ ] Confirm SPRITE-Integrations remains a separate public Discord app and choose its public name.
3. [ ] Choose the Symbiote distribution channel and update policy.
4. [ ] Approve scoped per-campaign credentials as the replacement for the shared webhook secret.
5. [ ] Answer the NPC/creature product decisions: types, control, default visibility, and explicit promotion vs auto-import.

### Codex — safe to start before every product decision is closed

1. [ ] Produce a technical design for scoped campaign provisioning; do not implement until credential UX is approved.
2. [ ] Inventory the current two-app onboarding path and propose the `/talespire setup` state machine and status contract.
3. [ ] Add a deterministic, secret-free Symbiote packaging/validation script on a feature branch.
4. [ ] Produce the canonical entity schema comparison and ownership-assumption audit.

### Moldy

1. [ ] Review each design against the product decisions and keep this tracker current.
2. [ ] Review implementation branches before merge.
3. [ ] Draft TaleSpire community launch material only after the clean install path is validated.

---

## Definition of Marketing-Ready

TaleSpire marketing can move from private testers to public acquisition when:

- [ ] A Premium user can discover and install the required second Discord app without operator intervention.
- [ ] The Symbiote has an official versioned download.
- [ ] No deployment-wide secret is distributed to users.
- [ ] Setup is resumable and status is diagnosable.
- [ ] The player-character-only limitation is either resolved or clearly disclosed.
- [ ] The complete journey has been tested in a clean guild with a clean TaleSpire installation.
