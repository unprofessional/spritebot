# TaleSpire Product & Delivery Gaps

> **Status:** Active planning
> **Owner:** mads
> **Engineering:** Codex
> **Review:** Moldy
> **Related repos:** `spritebot`, `spritebot-integrations`, `spriteweb`
> **Last updated:** 2026-07-21

## Purpose

Track the remaining core-product, onboarding, distribution, and commercial work required before the TaleSpire integration can be marketed as a clean self-service SPRITE feature.

NPC and creature modeling belongs to **SPRITEbot-prime**, not to the TaleSpire bridge. It is the first priority because it increases the base app's value independently and establishes a game-platform-agnostic actor model. TaleSpire is the first adapter that can consume that foundation; Roll20 or another future integration should be able to use the same contract without another core schema redesign. The remaining gaps cover selling the right plan, installing a second Discord app cleanly, and safely delivering the Symbiote.

## Current State

- TaleSpire access is bundled into the existing Premium SKU through `integrations:talespire`.
- SPRITE-Integrations can enforce SPRITE entitlements through its read-only connection to the SPRITE database.
- The Symbiote source exists under `spritebot-integrations/symbiote/` and can be installed manually.
- SPRITEbot-prime's canonical character model is still player-character-oriented and does not model general NPCs or creatures.
- SPRITE-Integrations already caches observed TaleSpire creatures in `campaign_creatures`, but that operational cache must remain downstream of the base app's canonical model.
- Public onboarding still assumes that an operator can hand the GM an integration-bot invite, a Symbiote folder, a webhook URL, a shared webhook secret, and setup instructions.

That operator-assisted path is acceptable for testers, but not for a marketed product.

---

## Gap 1 — SPRITEbot-prime Core NPC and Creature Modeling

### Why this comes first

NPCs and creatures are a base SPRITE product capability, not a TaleSpire-specific accommodation. GMs should be able to create, manage, reveal, and use them in SPRITEbot-prime even if they never install the TaleSpire integration.

Implementing the canonical model first increases the value of the base app and prevents any integration from inventing a parallel entity model that later has to be migrated. TaleSpire, Roll20, and future platforms should import or link into this model; none of them should define it.

This is more than making `character.user_id` nullable. NPCs and creatures have different control, selection, display, editing, and visibility semantics from player-owned characters. The core model also needs a stable integration boundary so adapters can identify and synchronize entities without leaking provider-specific concepts into the domain schema.

### Product decisions — mads

- [ ] Define the initial entity kinds. Proposed minimum: player character, NPC, and creature.
- [ ] Decide whether NPC and creature are behaviorally distinct at launch or initially differ only by type/label.
- [ ] Define creation and control:
  - player characters remain owned by a Discord user;
  - NPCs/creatures are created and controlled by the GM or game admins;
  - optional assignment to players can be deferred unless it has immediate base-app value.
- [ ] Define what base character capabilities NPCs/creatures reuse: stat templates, custom fields, inventory, proxy posting, public cards, and links.
- [ ] Define entity visibility. Proposed starting set:
  - `gm-only` — visible only to the GM/game admins;
  - `game` — visible to members of the game;
  - `public` — eligible for public/link surfaces.
- [ ] Decide whether launch requires stat/field-level visibility in addition to entity-level visibility.
- [ ] Define safe defaults. Recommendation: new NPCs/creatures default to `gm-only` and require an explicit reveal.
- [ ] Define how a GM selects or speaks as an NPC/creature without disrupting their active player character.
- [ ] Define lifecycle behavior: archive, delete, restore, transfer between games, and conversion between NPC/creature/player character where allowed.
- [ ] Define the product-level sync policy for external platforms: whether SPRITE, the external platform, or the GM controls each field when both sides can edit it.

### Engineering tasks — Codex

#### Phase P1 — Core-model design spike

- [ ] Audit every schema, DAO, service, command, component, and authorization assumption that a SPRITE character has a player owner.
- [ ] Compare two schema strategies:
  1. generalize the existing character model into a shared actor/entity model;
  2. add a separate game-entity model that reuses character capabilities deliberately.
- [ ] Trace the impact on stats, custom fields, inventory, RP proxying, active-character selection, autocomplete, public/link views, deletion/restoration, and existing URLs.
- [ ] Define a provider-agnostic adapter contract for identifying, linking, importing, and synchronizing canonical entities.
- [ ] Define source/provenance and conflict semantics for fields that can be edited in SPRITE or an external platform.
- [ ] Recommend one strategy with migration, compatibility, rollout, and rollback plans.
- [ ] Define authorization and visibility rules centrally before adding commands.

#### Phase P2 — Canonical schema and services

- [ ] Add the approved canonical entity schema and type discriminator.
- [ ] Implement owner/controller semantics that do not require a Discord user for NPCs/creatures.
- [ ] Add game-scoped authorization and visibility enforcement in the service layer.
- [ ] Expose the approved provider-neutral entity/linking contract without adding TaleSpire- or Roll20-specific columns to the core entity tables.
- [ ] Migrate existing player characters without changing their behavior.
- [ ] Add DAOs and service tests for every entity kind and visibility state.

#### Phase P3 — Base-app user experience

- [ ] Add GM-facing create, edit, list, view, archive/delete, restore, and visibility controls for NPCs/creatures.
- [ ] Reuse existing stat/custom-field/inventory flows where approved by the product decisions.
- [ ] Add a non-destructive way for a GM to post or act as an NPC/creature without replacing their active player character.
- [ ] Filter autocomplete, lists, cards, links, notifications, and RP surfaces according to visibility.
- [ ] Add explicit reveal/hide confirmation and audit logging where appropriate.
- [ ] Update `/help`, onboarding, and base-app documentation.

#### Phase P4 — Regression and value validation

- [ ] Add migration tests for existing characters and games.
- [ ] Add authorization tests proving normal players cannot discover, view, edit, autocomplete, or proxy hidden entities.
- [ ] Add end-to-end tests for a GM creating and using NPCs/creatures entirely inside SPRITEbot-prime.
- [ ] Validate the feature with a real game workflow before designing the TaleSpire import UX.

#### Phase P5 — External adapter foundation and TaleSpire adapter

- [ ] Implement provider/external-ID mappings at the adapter boundary rather than embedding TaleSpire identifiers in the canonical entity schema.
- [ ] Update SPRITE-Integrations to target the approved canonical entity contract as the first adapter.
- [ ] Let a GM link or import an observed TaleSpire creature as an existing/new SPRITE NPC or creature.
- [ ] Keep unimported TaleSpire roster entries in the integration cache only.
- [ ] Extend stat write-through, stale-link handling, conflict handling, and integration health reporting to the new canonical entities.
- [ ] Preserve SPRITEbot-prime authorization and visibility rules; no adapter may widen visibility implicitly.
- [ ] Validate the contract by sketching how a second adapter such as Roll20 would map entities without core schema changes. A Roll20 implementation is not required for this phase.

### Acceptance criteria

- A GM can create and use NPCs/creatures in SPRITEbot-prime without TaleSpire or SPRITE-Integrations.
- NPCs/creatures do not require a Discord-user owner.
- They reuse the approved base-app capabilities without duplicating stat/inventory models.
- New NPCs/creatures default to the safest visibility.
- Visibility is enforced consistently across commands, autocomplete, RP proxying, notifications, API/web surfaces, and public links.
- Existing player characters continue working without user-visible regressions.
- TaleSpire integration work begins only after the canonical base-app contract is stable.
- A future Roll20 or other platform adapter can link/sync entities through the same boundary without adding provider-specific fields to the core actor model.

---

## Gap 2 — Pro Plan Does Not Exist Yet

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

## Gap 3 — No Clean Way to Pull In SPRITE-Integrations

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

## Gap 4 — No User-Ready Symbiote Bundle or Delivery Path

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

## Recommended Sequencing

### Track 1 — SPRITEbot-prime NPC/creature foundation

1. Resolve base-product decisions for entity kinds, capabilities, control, selection, and visibility.
2. Run the ownership/schema/authorization design spike.
3. Implement the canonical model and migrate existing player characters safely.
4. Ship the complete base-app NPC/creature UX.
5. Validate it in a real game without TaleSpire.

This is the first product track and a prerequisite for TaleSpire entity import/linking. Its scope and value must stand on their own.

### Track 2 — Adapter layer, TaleSpire adaptation, and public onboarding

1. Stabilize the provider-neutral external entity/linking contract.
2. Adapt SPRITE-Integrations linking/write-through to that contract as adapter #1.
3. Validate that a future Roll20-style adapter would not require core schema changes.
4. Decide the second-app setup flow and public product name.
5. Replace the shared webhook secret with scoped campaign provisioning.
6. Build SPRITE's guided `/talespire setup` and status handoff.
7. Package and publish the versioned Symbiote artifact.
8. Validate the complete clean-guild/clean-machine journey.

The provisioning and packaging designs may be researched while Track 1 is underway, but implementation must not force or preempt the core entity model.

### Track 3 — Pro commercialization

1. mads defines and creates the Pro SKU.
2. Codex wires the SKU and subscription UX.
3. Update public pricing and launch copy.

This track is independent of TaleSpire while TaleSpire remains a Premium feature.

---

## Immediate Action Queue

### mads

1. [ ] Define the SPRITEbot-prime NPC/creature MVP: entity kinds, reused capabilities, controller rules, GM selection/proxy behavior, and visibility depth.
2. [ ] Confirm the safe defaults: GM-controlled, `gm-only`, and explicit reveal.
3. [ ] Confirm TaleSpire stays in Premium and define what Pro adds.
4. [ ] Confirm SPRITE-Integrations remains a separate public Discord app and choose its public name.
5. [ ] Choose the Symbiote distribution channel and update policy.
6. [ ] Approve scoped per-campaign credentials as the replacement for the shared webhook secret.

### Codex — first assignment

1. [ ] Produce the SPRITEbot-prime core-model design spike and ownership-assumption audit from Phase P1.
2. [ ] Define the provider-neutral adapter boundary and sync/conflict semantics as part of that design.
3. [ ] Do not design the canonical model around TaleSpire or Roll20 payloads; treat both as later adapters/consumers.

### Codex — safe parallel research

1. [ ] Produce a technical design for scoped campaign provisioning; do not implement until credential UX is approved.
2. [ ] Inventory the current two-app onboarding path and propose the `/talespire setup` state machine and status contract.
3. [ ] Add a deterministic, secret-free Symbiote packaging/validation design; implementation can wait behind the core model if necessary.

### Moldy

1. [ ] Review the SPRITEbot-prime design against the base-app product decisions before implementation starts.
2. [ ] Review each implementation phase before merge and keep this tracker current.
3. [ ] Draft TaleSpire community launch material only after the clean install path is validated.

---

## Definition of Marketing-Ready

TaleSpire marketing can move from private testers to public acquisition when:

- [ ] A Premium user can discover and install the required second Discord app without operator intervention.
- [ ] The Symbiote has an official versioned download.
- [ ] No deployment-wide secret is distributed to users.
- [ ] Setup is resumable and status is diagnosable.
- [ ] SPRITEbot-prime's game-agnostic canonical NPC/creature model is shipped and the TaleSpire adapter targets its provider-neutral contract.
- [ ] The complete journey has been tested in a clean guild with a clean TaleSpire installation.
