// src/types/stat_template.ts

export type CustomStatFieldType = 'number' | 'count' | 'short' | 'paragraph';

export interface CustomStatDefinition {
  id: string;
  game_id: string;
  stat_key: string;
  label: string;
  field_type: CustomStatFieldType;
  default_value: string | null;
  is_required: boolean;
  sort_order: number;
  meta: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export type StatTemplate = CustomStatDefinition;

export interface CreateStatTemplateParams {
  game_id: string;
  stat_key: string;
  label: string;
  field_type?: CustomStatFieldType;
  default_value?: string | null;
  is_required?: boolean;
  sort_order?: number;
  meta?: Record<string, unknown>;
}

export type CreateCustomStatDefinitionParams = CreateStatTemplateParams;
