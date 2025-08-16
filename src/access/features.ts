// src/access/features.ts

/**
 * Feature flags (capabilities) that plans/grants can enable.
 * Keep these stable; they’re referenced in plans, grants, and policy.
 */
export type FeatureKey =
  | 'core' // free baseline: view/list/browse
  | 'rpg:characters' // create/edit characters & stats
  | 'rpg:inventory' // inventory management (view/edit)
  | 'rpg:game-admin' // game/stat template admin
  | 'automation:thread-bump'; // auto-bump threads

/** Optional pretty labels for UI/receipts/logs */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  core: 'Core',
  'rpg:characters': 'Characters',
  'rpg:inventory': 'Inventory',
  'rpg:game-admin': 'Game Admin',
  'automation:thread-bump': 'Thread Bumping',
};

/**
 * Command → required feature mapping.
 * - Keep read-only and navigation commands on 'core'
 * - Gate create/edit/automation on premium features
 *
 * Tweak as your packaging evolves. This is a safe, user-friendly default.
 */
export const CommandPolicy: Record<string, FeatureKey> = {
  // Creation / Editing
  'create-character': 'rpg:characters',
  'create-game': 'rpg:game-admin',
  inventory: 'rpg:inventory',

  // Automation
  'bump-thread': 'automation:thread-bump',

  // Navigation / Viewing (free baseline)
  'view-character': 'core',
  'list-characters': 'core',
  'switch-character': 'core',
  'view-game': 'core',
  'list-games': 'core',
  'join-game': 'core',
  'switch-game': 'core',
};
