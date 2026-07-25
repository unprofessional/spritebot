CREATE TABLE game_entity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('npc', 'creature')),
  name TEXT NOT NULL,
  avatar_url TEXT,
  rp_display_name TEXT,
  rp_display_avatar_url TEXT,
  bio TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public', 'link-only')),
  deleted_at TIMESTAMP,
  deleted_by_game BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX game_entity_active_game_idx
  ON game_entity (game_id, kind, created_at)
  WHERE deleted_at IS NULL;

CREATE TABLE game_entity_stat_field (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_entity_id UUID NOT NULL REFERENCES game_entity(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES stat_template(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  meta JSONB DEFAULT '{}',
  UNIQUE (game_entity_id, template_id)
);

CREATE TABLE game_entity_custom_field (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_entity_id UUID NOT NULL REFERENCES game_entity(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  meta JSONB DEFAULT '{}',
  UNIQUE (game_entity_id, name)
);

CREATE TABLE game_entity_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_entity_id UUID NOT NULL REFERENCES game_entity(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  equipped BOOLEAN DEFAULT FALSE,
  description TEXT
);

CREATE TABLE game_entity_inventory_field (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID NOT NULL REFERENCES game_entity_inventory(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  meta JSONB DEFAULT '{}',
  UNIQUE (inventory_id, name)
);

CREATE INDEX idx_game_entity_stat_entity_id ON game_entity_stat_field(game_entity_id);
CREATE INDEX idx_game_entity_custom_entity_id ON game_entity_custom_field(game_entity_id);
CREATE INDEX idx_game_entity_inventory_entity_id ON game_entity_inventory(game_entity_id);
CREATE INDEX idx_game_entity_inventory_field_inventory_id
  ON game_entity_inventory_field(inventory_id);
