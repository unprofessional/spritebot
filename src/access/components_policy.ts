// src/access/components_policy.ts
import type { FeatureKey } from './features';

/**
 * Component (customId prefix) → required feature mapping.
 * Match order matters: we use startsWith() against each prefix.
 *
 * Conventions:
 * - Keep pure "view / paginate / back" actions on 'core'
 * - Gate create/edit/delete/admin on premium features
 * - Inventory mutating actions → 'rpg:inventory'
 * - Game/stat template admin → 'rpg:game-admin'
 * - Character create/edit/delete/visibility → 'rpg:characters'
 */
export const ComponentPolicy: Array<[prefix: string, feature: FeatureKey]> = [
  // ===== GAME / STAT TEMPLATE ADMIN (gated) =====
  ['defineStats:', 'rpg:game-admin'],
  ['editGameStats:', 'rpg:game-admin'],
  ['deleteStats:', 'rpg:game-admin'],
  ['finishStatSetup:', 'rpg:game-admin'],
  ['togglePublishGame:', 'rpg:game-admin'],
  ['confirmDeleteStat:', 'rpg:game-admin'],
  ['editStatSelect:', 'rpg:game-admin'],
  ['deleteStatSelect:', 'rpg:game-admin'],
  ['selectStatType:', 'rpg:game-admin'],
  ['editStatTemplateModal:', 'rpg:game-admin'],
  ['createStatModal:', 'rpg:game-admin'],

  // ===== CHARACTER CREATE / EDIT / DELETE (gated) =====
  ['submitNewCharacter', 'rpg:characters'],
  ['deleteCharacter', 'rpg:characters'],
  ['confirmDeleteCharacter', 'rpg:characters'],
  ['editCharacterStat', 'rpg:characters'], // buttons
  ['editCharacterStatDropdown:', 'rpg:characters'], // select
  ['createCharacterDropdown', 'rpg:characters'], // select
  ['editCharacterFieldDropdown', 'rpg:characters'], // select
  ['createCharacterModal:', 'rpg:characters'], // modal
  ['createDraftCharacterField:', 'rpg:characters'], // modal
  ['editCharacterModal:', 'rpg:characters'], // modal
  ['editStatModal:', 'rpg:characters'], // modal
  ['setCharacterField:', 'rpg:characters'], // modal
  ['editCharacterField:', 'rpg:characters'], // modal
  ['handleToggleCharacterVisibilityButton:', 'rpg:characters'],

  // Adjusting numeric stats via calculator (mutating) → gated
  ['adjustStatSelect:', 'rpg:characters'], // select
  ['adjustStatModal:', 'rpg:characters'], // modal

  // ===== INVENTORY (view = core, mutations = gated) =====
  ['add_inventory_item:', 'rpg:inventory'], // button → modal follows
  ['addInventoryModal:', 'rpg:inventory'], // modal
  ['clear_inventory:', 'rpg:inventory'], // button
  ['confirm_clear_inventory:', 'rpg:inventory'], // button

  // ===== CORE (read-only navigation / safe actions) =====
  ['view_inventory:', 'core'], // read-only
  ['cancel_clear_inventory', 'core'], // cancel action
  ['charPage:', 'core'], // pagination on char views
  ['goBackToCharacter:', 'core'], // nav
  ['viewParagraphFields', 'core'], // open long fields
  ['paragraphFieldSelect', 'core'], // select which long field
  ['switchCharacterDropdown', 'core'], // switch context
  ['switchGameDropdown', 'core'], // switch context
  ['joinGameDropdown', 'core'], // join game (request)
  ['selectPublicCharacter', 'core'], // filter public list
  ['calculateCharacterStats:', 'core'], // compute/display only (non-mutating)
];
