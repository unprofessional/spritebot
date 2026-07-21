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
  | 'automation:thread-bump' // auto-bump threads
  | 'pro:transcription' // voice transcription
  | 'integrations:talespire'; // TaleSpire bridge access

/** Explicit interaction access policy. `public` means no entitlement gate is required. */
export type FeaturePolicy = FeatureKey | 'public';

/** Optional pretty labels for UI/receipts/logs */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  core: 'Core',
  'rpg:characters': 'Characters',
  'rpg:inventory': 'Inventory',
  'rpg:game-admin': 'Game Admin',
  'automation:thread-bump': 'Thread Bumping',
  'pro:transcription': 'Voice Transcription',
  'integrations:talespire': 'TaleSpire Integration',
};

/**
 * Command → required feature mapping.
 * - Keep read-only and navigation commands on 'core'
 * - Gate create/edit/automation on premium features
 *
 * Tweak as your packaging evolves. This is a safe, user-friendly default.
 */
export const CommandPolicy: Record<string, FeaturePolicy> = {
  // === Free (core) ===
  'view-character': 'core',
  'list-characters': 'core',
  'switch-character': 'core',
  'view-game': 'core',
  'list-games': 'core',
  'join-game': 'core',
  'switch-game': 'core',
  roll: 'core',
  help: 'core',
  subscribe: 'public',
  support: 'public',
  verify: 'public',
  'verify-greeting': 'public',
  admin: 'public',
  gift: 'public',
  'toggle-bypass': 'public',

  // === Premium (stateful) ===
  'create-character': 'rpg:characters',
  'restore-character': 'rpg:characters',
  ic: 'rpg:characters',
  ooc: 'rpg:characters',
  'ic-edit': 'rpg:characters',
  'Edit IC Message': 'rpg:characters',
  'ic-delete': 'rpg:characters',
  'Delete IC Message': 'rpg:characters',
  'create-game': 'rpg:game-admin',
  'restore-game': 'rpg:game-admin',
  'bot-announcements': 'rpg:game-admin',
  inventory: 'rpg:inventory',
  'bump-thread': 'automation:thread-bump',

  // === Pro ===
  transcribe: 'pro:transcription',
};
