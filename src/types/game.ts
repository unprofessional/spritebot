// src/types/game.ts

export interface Game {
  id: string;
  name: string;
  description: string;
  created_by: string;
  guild_id?: string | null;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface StatTemplate {
  id: string;
  game_id: string;
  label: string;
  field_type: 'number' | 'text_short' | 'text_paragraph' | 'count';
  default_value?: string | null;
  sort_index?: number;
  is_required?: boolean;
  created_at?: string;
  updated_at?: string;
}
