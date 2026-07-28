// src/types/game.ts

export interface Game {
  id: string;
  name: string;
  description: string;
  created_by: string;
  guild_id?: string | null;
  is_public: boolean;
  preset_key?: string | null;
  preset_version?: number | null;
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type { CustomStatDefinition, CustomStatDefinition as StatTemplate } from './stat_template';
