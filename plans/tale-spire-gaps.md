# TaleSpire Product & Delivery Gaps

> **Status:** Active planning
> **Owner:** mads
> **Engineering:** Codex
> **Review:** Moldy
> **Related repos:** `spritebot`, `spritebot-integrations`, `spriteweb`
> **Last updated:** 2026-07-27

## Purpose

Track the remaining core-product, onboarding, distribution, and commercial work required before the TaleSpire integration can be marketed as a clean self-service SPRITE feature.

NPC and creature modeling belongs to **SPRITEbot-prime**, not to the TaleSpire bridge. The base feature and the explicit SPRITE-Integrations bridge are now shipped and deployed. The base implementation record lives in [`done/game-entities.md`](done/game-entities.md); the bridge implementation record lives in [`spritebot-integrations/plans/talespire-game-entity-bridge.md`](https://github.com/unprofessional/spritebot-integrations/blob/develop/plans/talespire-game-entity-bridge.md). The remaining gaps cover selling the right plan, installing the second Discord app cleanly, replacing shared credentials, and safely delivering the Symbiote.

## Current State

- TaleSpire access is bundled into the existing Premium SKU through `integrations:talespire`.
- SPRITE-Integrations can enforce SPRITE entitlements through its direct SPRITE database bridge. That connection also supports existing character/stat lookups and write-through, so it is not read-only.
- The Symbiote source exists under `spritebot-integrations/symbiote/` and can be installed manually.
- SPRITEbot-prime's additive `game_entity` sibling model is shipped through merge `882e93a`, including NPC/creature CRUD, stats, custom fields, inventory, visibility, deletion, restoration, automated gates, and real Discord lifecycle validation.
- SPRITE-Integrations caches observed TaleSpire creatures in `campaign_creatures` and now provides the deployed `/entity promote`, `/entity link`, `/entity unlink`, and `/entity list` bridge. Cached rows remain integration-local until a GM explicitly promotes or links one.
- Entity selection is name-driven and duplicate-safe. Discord autocomplete keeps TaleSpire and SPRITE UUIDs internal, while normal list output shows human-readable source names, link state, and resolvable target name/kind/visibility.
- Public onboarding still assumes that an operator can hand the GM an integration-bot invite, a Symbiote folder, a webhook URL, a shared webhook secret, and setup instructions.

That operator-assisted path is acceptable for testers, but not for a marketed product.

---

## Completed Foundation — TaleSpire-to-SPRITE Game-Entity Bridge

> **Status:** Base feature and explicit Integrations bridge shipped, merged, and deployed.

NPCs and creatures are shipped as a base SPRITE capability using the additive `game_entity` sibling model. Existing player characters remain untouched.

The separate Integrations implementation now lets a GM explicitly promote or link a cached TaleSpire creature to a SPRITE game entity and writes mapped TaleSpire stats into `game_entity_stat_field`. Unlinked roster rows stay integration-local; nothing is imported automatically.

The deployed bridge preserves IDs only as internal autocomplete and persistence values. Users select entities by human-readable names and context, and `/entity list` does not print either the TaleSpire source UUID or SPRITE target UUID. The schema, command UX, target-conflict rules, write-through behavior, status codes, phases, and acceptance criteria live in the focused [`TaleSpire game-entity bridge plan`](https://github.com/unprofessional/spritebot-integrations/blob/develop/plans/talespire-game-entity-bridge.md).

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

### Track 1 — SPRITEbot-prime game entities — complete

1. [x] Implement the additive sibling schema and application work in [`done/game-entities.md`](done/game-entities.md).
2. [x] Ship game-owned NPC/creature CRUD, stats, custom fields, inventory, visibility, deletion, and restoration.
3. [x] Validate the base feature through automated gates and a real Discord lifecycle smoke test.

The shipped feature does not migrate or generalize player characters. It is now the stable prerequisite for TaleSpire entity linking.

### Track 2 — TaleSpire linking and public onboarding

1. [x] Implement and deploy the focused [TaleSpire game-entity bridge plan](https://github.com/unprofessional/spritebot-integrations/blob/develop/plans/talespire-game-entity-bridge.md), including explicit cached-creature promotion/linking and mapped stat write-through.
2. Decide the second-app setup flow and public product name.
3. Replace the shared webhook secret with scoped campaign provisioning.
4. Build SPRITE's guided `/talespire setup` and status handoff.
5. Package and publish the versioned Symbiote artifact.
6. Validate the complete clean-guild/clean-machine journey.

Provisioning and packaging research may proceed in parallel. TaleSpire linking remains owned by the separate Integrations application; its implementation and base SPRITE prerequisite are both complete.

### Track 3 — Pro commercialization

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

### Codex — completed bridge assignment

1. [x] Implement and deploy the approved TaleSpire game-entity bridge in `spritebot-integrations` as independently reviewable Phase 6K passes.
2. [x] Keep the bridge explicit: no automatic roster import and no SPRITE entity deletion from the integration app.
3. [x] Replace user-facing UUID entry/output with name-driven, ID-backed selection and human-readable link status.

### Codex — safe parallel research

1. [ ] Produce a technical design for scoped campaign provisioning; do not implement until credential UX is approved.
2. [ ] Inventory the current two-app onboarding path and propose the `/talespire setup` state machine and status contract.
3. [ ] Add a deterministic, secret-free Symbiote packaging/validation design; implementation can wait behind the core model if necessary.

### Moldy

1. [x] Review each TaleSpire game-entity bridge phase before merge.
2. [ ] Draft TaleSpire community launch material only after the clean install path is validated.

---

## Definition of Marketing-Ready

TaleSpire marketing can move from private testers to public acquisition when:

- [ ] A Premium user can discover and install the required second Discord app without operator intervention.
- [ ] The Symbiote has an official versioned download.
- [ ] No deployment-wide secret is distributed to users.
- [ ] Setup is resumable and status is diagnosable.
- [x] SPRITEbot-prime game entities and the explicit TaleSpire promotion/link bridge are shipped and deployed.
- [ ] The complete journey has been tested in a clean guild with a clean TaleSpire installation.
