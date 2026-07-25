export type GameEntityKind = 'npc' | 'creature';
export type GameEntityVisibility = 'public' | 'private' | 'link-only';
export type JsonObject = Record<string, unknown>;

export interface GameEntity {
  id: string;
  game_id: string;
  created_by: string;
  kind: GameEntityKind;
  name: string;
  avatar_url: string | null;
  rp_display_name: string | null;
  rp_display_avatar_url: string | null;
  bio: string | null;
  visibility: GameEntityVisibility;
  deleted_at: string | null;
  deleted_by_game: boolean;
  created_at: string;
  last_updated_at: string;
}

export interface GameEntityStatField {
  id: string;
  game_entity_id: string;
  template_id: string;
  value: string;
  meta: JsonObject;
}

export interface HydratedGameEntityStatField extends GameEntityStatField {
  label: string;
  field_type: string;
  sort_order: number;
}

export interface GameEntityCustomField {
  id: string;
  game_entity_id: string;
  name: string;
  value: string;
  meta: JsonObject;
}

export interface GameEntityInventoryItem {
  id: string;
  game_entity_id: string;
  name: string;
  type: string | null;
  quantity: number;
  equipped: boolean;
  description: string | null;
}

export interface GameEntityInventoryField {
  id: string;
  inventory_id: string;
  name: string;
  value: string;
  meta: JsonObject;
}

export interface HydratedGameEntityInventoryItem extends GameEntityInventoryItem {
  fields: GameEntityInventoryField[];
}

export interface HydratedGameEntity extends GameEntity {
  stats: HydratedGameEntityStatField[];
  customFields: GameEntityCustomField[];
  inventory: HydratedGameEntityInventoryItem[];
}
