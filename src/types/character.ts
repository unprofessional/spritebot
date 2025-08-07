// src/types/character.ts

import type { StatFieldEntry } from '../dao/character_stat_field.dao';
import type { FieldInput } from './field_input';

export interface CharacterDraft {
  id: string;
  user_id: string;
  game_id: string;
  data: Record<string, any>;
  builder_message_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Character {
  id: string;
  game_id: string;
  user_id: string;
  name: string;
  avatar_url?: string | null;
  bio?: string | null;
  visibility?: 'public' | 'private';
  created_at?: string;
  updated_at?: string;
}

export interface CharacterStatWithLabel extends StatFieldEntry {
  label: string;
  field_type: string;
  template_id?: string;
  sort_index?: number;
}

export interface CharacterWithStats extends Character {
  stats: CharacterStatWithLabel[];
  customFields: FieldInput[];
}

export interface InventoryItem {
  id: string;
  name: string;
  type?: string | null;
  description?: string | null;
  equipped: boolean;
  fields?: Record<string, unknown>;
}

export interface CharacterWithInventory {
  id: string;
  name: string;
  inventory: InventoryItem[];
}

export interface HydratedStatField {
  template_id: string;
  value: string;
  meta: Record<string, any>;
  label: string;
  field_type: string;
}

export interface HydratedCustomField {
  name: string;
  value: string;
  meta: Record<string, any>;
}

export interface UserDefinedField {
  name: string;
  label: string; // make required (was: label?: string)
  meta?: Record<string, any>;
}
