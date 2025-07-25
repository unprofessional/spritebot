// src/types/stat_template.ts

export interface StatTemplate {
  id: string;
  game_id: string;
  label: string;
  field_type: 'number' | 'count' | 'short' | 'paragraph';
  default_value: string | null;
  is_required: boolean;
  sort_order: number;
  meta: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface CreateStatTemplateParams {
  game_id: string;
  label: string;
  field_type?: string;
  default_value?: string | null;
  is_required?: boolean;
  sort_order?: number;
  meta?: Record<string, unknown>;
}
