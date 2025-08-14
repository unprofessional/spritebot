-- -- -- -- -- --
-- RPG TRACKER: FLEXIBLE CHARACTER SYSTEM (REFACTORED, REORDERED + CLEANED)
-- -- -- -- -- --

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- === GAME METADATA ===
CREATE TABLE game (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN DEFAULT FALSE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- === GAME-DEFINED STAT FIELD TEMPLATES ===
CREATE TABLE stat_template (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'short'
    CHECK (field_type IN ('short', 'paragraph', 'number', 'count')),
  default_value TEXT,
  is_required BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  meta JSONB DEFAULT '{}'
);

-- === CHARACTERS ===
CREATE TABLE character (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, -- Discord user ID
  name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  visibility TEXT DEFAULT 'private' CHECK (visibility IN ('private', 'public', 'link-only')),
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- === PLAYER ACCOUNTS (GLOBAL IDENTITY) ===
CREATE TABLE player (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- === PLAYER SERVER CONTEXT (PER-GUILD CONFIG) ===
CREATE TABLE player_server_link (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  role TEXT DEFAULT 'player' CHECK (role IN ('player', 'gm')),
  current_character_id UUID REFERENCES character(id) ON DELETE SET NULL,
  current_game_id UUID REFERENCES game(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(player_id, guild_id)
);

-- === TEMPLATE-BASED STAT FIELDS PER CHARACTER ===
CREATE TABLE character_stat_field (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES stat_template(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  meta JSONB DEFAULT '{}',
  UNIQUE(character_id, template_id)
);

-- === PLAYER-DEFINED CUSTOM FIELDS ===
CREATE TABLE character_custom_field (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  meta JSONB DEFAULT '{}',
  UNIQUE(character_id, name)
);

-- === INVENTORY ITEMS ===
CREATE TABLE character_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  equipped BOOLEAN DEFAULT FALSE,
  description TEXT
);

-- === INVENTORY ITEM FIELDS ===
CREATE TABLE character_inventory_field (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID NOT NULL REFERENCES character_inventory(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  meta JSONB DEFAULT '{}',
  UNIQUE(inventory_id, name)
);

-- === THREAD AUTO-BUMPS (PER-THREAD SCHEDULING) ===
CREATE TABLE thread_bumps (
  thread_id TEXT PRIMARY KEY,                         -- Discord thread channel ID
  guild_id TEXT NOT NULL,                             -- Discord guild/server ID
  added_by TEXT NOT NULL,                             -- Discord user ID who registered it
  note TEXT,                                          -- Optional note to include in bump messages
  interval_minutes INTEGER NOT NULL DEFAULT 10080,    -- Minutes between bumps (default: weekly)
  last_bumped_at TIMESTAMPTZ,                         -- When the last bump was sent
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_due_at TIMESTAMPTZ                              -- maintained by trigger below
);

-- Keep updated_at in sync automatically for thread_bumps
CREATE OR REPLACE FUNCTION update_thread_bumps_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_thread_bumps_updated_at
BEFORE UPDATE ON thread_bumps
FOR EACH ROW
EXECUTE FUNCTION update_thread_bumps_updated_at();

-- Maintain next_due_at on INSERT/UPDATE
CREATE OR REPLACE FUNCTION set_thread_bumps_next_due()
RETURNS TRIGGER AS $$
BEGIN
  NEW.next_due_at :=
    COALESCE(NEW.last_bumped_at, NEW.created_at)
    + (INTERVAL '1 minute' * NEW.interval_minutes);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER compute_thread_bumps_next_due
BEFORE INSERT OR UPDATE OF last_bumped_at, interval_minutes ON thread_bumps
FOR EACH ROW
EXECUTE FUNCTION set_thread_bumps_next_due();

-- Index for due-time queries (simple btree on plain column)
CREATE INDEX idx_thread_bumps_next_due ON thread_bumps (next_due_at);

-- === INDEXES ===
-- Game + Guild lookup
CREATE INDEX idx_game_guild_id ON game(guild_id);

-- Character lookups
CREATE INDEX idx_character_user_id ON character(user_id);
CREATE INDEX idx_character_game_id ON character(game_id);

-- Stat lookups
CREATE INDEX idx_stat_character_id ON character_stat_field(character_id);
CREATE INDEX idx_stat_template_game_id ON stat_template(game_id);

-- Custom field lookup
CREATE INDEX idx_custom_stat_character_id ON character_custom_field(character_id);

-- Inventory lookups
CREATE INDEX idx_inventory_character_id ON character_inventory(character_id);
CREATE INDEX idx_inventory_field_inventory_id ON character_inventory_field(inventory_id);

-- Player-server context lookups
CREATE INDEX idx_player_server_link_player_id ON player_server_link(player_id);
CREATE INDEX idx_player_server_link_guild_id ON player_server_link(guild_id);
CREATE INDEX idx_player_server_link_player_guild ON player_server_link(player_id, guild_id);
