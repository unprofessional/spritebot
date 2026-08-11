# Modal Dropdown UX Modernization

## Status

Planned. This work requires a discord.js upgrade before production modal builders can use
Discord's current Label-wrapped select components.

## Problem

SPRITEbot's modals were built when Discord only supported text inputs in modals. Some fields that
are finite choices are therefore presented as free-form text. Users must learn syntax, type exact
tokens, and recover from validation failures that the UI could prevent.

The clearest example is numeric and count-stat adjustment. The user currently types one of `+`,
`-`, `*`, or `/` into an operator text box even though those are the only valid choices. Discord
now supports select menus in modals, so the operator can be a dropdown while the operand remains a
numeric text input.

This plan audits every modal, converts appropriate closed-choice inputs, and establishes reusable
modal-component patterns without changing service or persistence semantics.

## Goals

- Replace finite-choice text inputs with native Discord modal selects.
- Keep genuinely free-form and numeric inputs as text inputs.
- Prevent invalid input at the interaction boundary where Discord can express the constraint.
- Preserve authorization, prepared-modal timing, validation, and ephemeral-message update behavior.
- Provide shared builders and parsing helpers so modal components remain consistent and testable.
- Verify behavior in real Discord clients after the dependency upgrade.

## Non-goals

- Redesigning commands that already use appropriate message-level selects or autocomplete.
- Replacing numeric text entry with enumerated values when the valid range is open-ended.
- Moving business validation into Discord handlers.
- Changing stat, inventory, character, entity, or RP-message data models.
- Adding named-stat behavior or special cases for particular games.

## Current Modal Inventory

| Area                               | Modal inputs                                            | Dropdown opportunity                                                 | Recommendation                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Numeric/count adjustment           | Operator; operand                                       | Operator is exactly `+`, `-`, `*`, `/`                               | **Convert operator first**; retain numeric operand input                                                                       |
| Character count-stat create/edit   | Maximum; current                                        | Values are open-ended whole numbers                                  | Retain text inputs; improve labels, bounds copy, and validation                                                                |
| Entity count-stat edit             | Maximum; current                                        | Values are open-ended whole numbers                                  | Retain text inputs and use the same shared count renderer/parser as characters                                                 |
| Custom-stat definition create/edit | Label; stable key; default; current default; sort order | Field type is finite but is already selected before the modal        | Retain text inputs; audit whether the preceding type-selection step can be folded into a modal select without harming the flow |
| Character core/custom fields       | Name/bio/custom value                                   | Values are free-form                                                 | Retain text inputs                                                                                                             |
| Entity core/custom fields          | Name/bio/custom value                                   | Kind and visibility are finite, but are managed outside these modals | Retain value inputs; evaluate a consolidated metadata modal only as a later UX option                                          |
| Character inventory add/edit       | Name; type/category; quantity; description              | Type/category is currently user-defined; quantity is open-ended      | Retain text inputs unless a canonical category registry is introduced                                                          |
| Entity inventory add/edit          | Name; type/category; quantity; description              | Same as character inventory                                          | Retain text inputs and keep both inventory experiences aligned                                                                 |
| IC message edit                    | Message content                                         | Free-form prose                                                      | Retain paragraph input                                                                                                         |
| Stat-template edit                 | Label; defaults; sort order                             | Type is immutable in this flow                                       | Retain text inputs                                                                                                             |

The implementation audit must search for both builders and raw component payloads so future or
less obvious modal construction is not missed:

```text
ModalBuilder
TextInputBuilder
showModal(
presentPreparedModal(
type: 9
type: 18
```

## UX Rules

1. Use a dropdown when the valid choices are finite, stable, and understandable as labels.
2. Keep IDs or machine tokens in option values; show plain-language labels and descriptions.
3. Do not use a dropdown for an arbitrary number, name, key, category, or prose field.
4. Preselect the current value when editing an existing setting.
5. Keep option labels within Discord's limits and use the shared bounded-label utilities.
6. Treat modal selections as untrusted input at submission time. Services must still validate and
   authorize the requested operation.
7. Preserve the user's existing message whenever the current flow edits an ephemeral response.
8. Use the same component and copy for equivalent character and entity operations.

## Proposed Shared Infrastructure

Add a small modal-component utility layer after upgrading discord.js:

- A Label-wrapped text-input builder.
- A Label-wrapped string-select builder.
- A typed finite-choice definition with bounded labels, descriptions, and values.
- Submission readers that understand the nested Label response shape.
- A reusable math-operator select definition shared by all numeric/count adjustments.
- Tests for Discord limits: custom IDs, labels, descriptions, option counts, and defaults.

Do not build a generic form framework. The utility should only remove Discord payload boilerplate
and centralize constraints.

## Phases

### Phase 1 — Dependency and Component Foundation

1. Upgrade discord.js to a release that exposes the current modal component builders, including
   `LabelBuilder` and modal-compatible select builders.
2. Review the discord.js and Discord API migration notes for changed interaction response types.
3. Add a minimal modal containing one Label-wrapped text input and one Label-wrapped string select
   in focused tests.
4. Extend modal-submit field extraction to handle Label-nested component results without weakening
   existing text-input handling.
5. Add shared builders and boundary-limit tests.
6. Confirm legacy ActionRow-wrapped text-input modals still work during staged migration, or migrate
   all modal wrappers together if mixed usage is unsupported by the selected discord.js release.

**Gate:** Build, interaction-dispatch tests, modal-submit tests, and a real Discord smoke modal all
pass before feature conversions begin.

### Phase 2 — Numeric and Count Adjustment Operator

1. Replace the operator text input in
   `src/handlers/select_menu_handlers/adjust_numeric_stat_select.ts` with a required string select:
   - `Add (+)` -> `+`
   - `Subtract (-)` -> `-`
   - `Multiply (x)` -> `*`
   - `Divide (/)` -> `/`
2. Keep the operand as a required numeric text input.
3. Preserve the existing custom ID and prepared-modal interaction policy where practical.
4. Update modal submission parsing for the selected operator.
5. Retain service-side operator, numeric, divide-by-zero, authorization, stale-character, and
   stale-stat validation.
6. Cover every operator, malformed/tampered values, default selection behavior, and count-stat
   bounds in focused tests.

**Gate:** A user can adjust number and count stats without typing operator syntax, and crafted
invalid submissions remain safely rejected.

### Phase 3 — Complete Modal Audit and Targeted Conversions

Review every row in the inventory above against the implemented UX rules. For each modal:

1. Record whether each input is free-form, constrained numeric, boolean, enum, or entity-backed.
2. Convert only finite enums with a clear user-facing benefit.
3. Consider these candidates explicitly:
   - Any remaining boolean text entry -> radio group, checkbox, or select.
   - Any visibility choice -> `Public` / `Private` if moved into a modal; do not expose Link Only
     while the product UI remains Publish/Unpublish-only.
   - Any entity kind choice -> `NPC` / `Creature` if a metadata modal is introduced.
   - Stat field type -> `Short text` / `Paragraph` / `Number` / `Count`, only if combining it with
     definition creation reduces steps and still preserves the immutable-key contract.
4. Keep inventory category free-form unless product requirements establish a finite taxonomy.
5. Keep all quantities, defaults, current/max values, labels, stable keys, and prose as text inputs.
6. Bring character/entity equivalents onto the same shared renderer and submission parser.

**Gate:** The audit table is updated with the disposition of every modal input, converted flows have
focused tests, and no free-form capability is accidentally narrowed.

### Phase 4 — Migration, Regression, and Discord Smoke Testing

1. Migrate remaining legacy modal text inputs from deprecated ActionRow wrapping to Label wrapping.
2. Verify all modal entry paths preserve acknowledgement deadlines and prepared-modal behavior.
3. Test stale interactions, crafted custom IDs, missing records, lost authorization, duplicate
   submissions, and invalid component values.
4. Verify desktop, web, iOS, and Android rendering where practical, including defaults and long
   labels.
5. Update user help text or screenshots that instruct users to type finite tokens.
6. Run Prettier, lint, focused tests, the full suite, build, Discord-boundary audits, and
   `git diff --check`.

**Gate:** All production modal flows pass automated regression coverage and representative real-client
smoke tests.

## Acceptance Criteria

- Numeric/count adjustment offers a dropdown for the operator and never asks users to type operator
  syntax.
- Every production modal and raw modal payload has been inventoried and classified.
- All finite-choice conversions have an explicit UX rationale and focused tests.
- Character and entity count-stat flows remain behaviorally consistent.
- Free-form fields remain free-form, and open-ended numeric values remain text inputs.
- Submission-time authorization and validation are unchanged or stronger.
- No UUIDs, internal IDs, or backend-only visibility states are exposed in labels.
- Modal custom IDs and option labels are bounded by shared Discord-limit utilities.
- The discord.js upgrade passes the full suite, build, and real Discord modal smoke tests.

## Risks and Mitigations

- **Library/API shape changes:** isolate the discord.js upgrade in Phase 1 and test nested modal-submit
  payloads before altering UX.
- **Mixed legacy/new modal wrappers:** determine compatibility once, then migrate consistently.
- **Client rollout differences:** smoke-test representative Discord clients before broad deployment.
- **False confidence from UI constraints:** keep service validation and authorization authoritative.
- **Over-enumeration:** require an explicit finite domain before converting any free-form input.
- **Interaction expiry:** preserve existing immediate/prepared modal policies and test response timing.

## Follow-up Questions

- Should multiplication be labeled `Multiply (x)` for readability while retaining `*` internally?
- Should the operator default to `Add (+)`, or require an explicit choice to prevent accidental
  adjustments?
- Should stat type move into the definition modal, or does the existing pre-modal selection provide
  a clearer staged workflow?
- Are inventory categories intentionally free-form, or should a separate product decision define a
  canonical category list?
