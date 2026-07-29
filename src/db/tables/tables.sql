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
  deleted_at TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- === GAME-DEFINED STAT FIELD TEMPLATES ===
CREATE TABLE stat_template (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  stat_key TEXT NOT NULL
    CONSTRAINT stat_template_stat_key_format_check
    CHECK (stat_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'short'
    CHECK (field_type IN ('short', 'paragraph', 'number', 'count')),
  default_value TEXT,
  is_required BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  meta JSONB DEFAULT '{}',
  CONSTRAINT stat_template_game_stat_key_unique UNIQUE (game_id, stat_key)
);

CREATE OR REPLACE FUNCTION prevent_stat_template_key_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stat_key IS DISTINCT FROM OLD.stat_key THEN
    RAISE EXCEPTION 'stat_template.stat_key is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stat_template_key_immutable
BEFORE UPDATE OF stat_key ON stat_template
FOR EACH ROW
EXECUTE FUNCTION prevent_stat_template_key_change();

-- === INTEGRATION-ASSISTED CUSTOM-STAT REGISTRATION ===
CREATE TABLE custom_stat_registration_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  definition_id UUID REFERENCES stat_template(id) ON DELETE SET NULL,
  actor_discord_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('created', 'existing_equivalent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT custom_stat_registration_audit_idempotency_unique
    UNIQUE (game_id, idempotency_key)
);

CREATE OR REPLACE FUNCTION list_custom_stat_definitions(p_game_id UUID)
RETURNS TABLE (
  id UUID,
  game_id UUID,
  stat_key TEXT,
  label TEXT,
  field_type TEXT,
  default_value TEXT,
  is_required BOOLEAN,
  sort_order INTEGER,
  meta JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    st.id,
    st.game_id,
    st.stat_key,
    st.label,
    st.field_type,
    st.default_value,
    st.is_required,
    st.sort_order,
    st.meta
  FROM stat_template st
  JOIN game g ON g.id = st.game_id
  WHERE st.game_id = p_game_id
    AND g.deleted_at IS NULL
  ORDER BY st.sort_order ASC, st.label ASC, st.stat_key ASC;
END;
$$ LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION register_custom_stat_definition(
  p_game_id UUID,
  p_stat_key TEXT,
  p_label TEXT,
  p_field_type TEXT,
  p_default_value TEXT,
  p_is_required BOOLEAN,
  p_sort_order INTEGER,
  p_meta JSONB,
  p_actor_discord_user_id TEXT,
  p_idempotency_key TEXT
)
RETURNS TABLE (
  outcome TEXT,
  id UUID,
  stat_key TEXT
) AS $$
DECLARE
  normalized_is_required BOOLEAN := COALESCE(p_is_required, TRUE);
  normalized_sort_order INTEGER := COALESCE(p_sort_order, 0);
  normalized_meta JSONB := COALESCE(p_meta, '{}'::JSONB);
  request_fingerprint TEXT;
  prior_audit custom_stat_registration_audit%ROWTYPE;
  existing_definition stat_template%ROWTYPE;
  created_definition stat_template%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM game g
    WHERE g.id = p_game_id
      AND g.deleted_at IS NULL
  ) THEN
    RETURN QUERY SELECT 'target_missing'::TEXT, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  IF p_stat_key IS NULL
    OR p_stat_key !~ '^[a-z][a-z0-9_]{0,63}$'
    OR p_label IS NULL
    OR btrim(p_label) = ''
    OR p_field_type IS NULL
    OR p_field_type NOT IN ('short', 'paragraph', 'number', 'count')
    OR p_actor_discord_user_id IS NULL
    OR btrim(p_actor_discord_user_id) = ''
    OR p_idempotency_key IS NULL
    OR btrim(p_idempotency_key) = ''
    OR jsonb_typeof(normalized_meta) <> 'object'
  THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::UUID, p_stat_key;
    RETURN;
  END IF;

  IF p_field_type = 'number'
    AND p_default_value IS NOT NULL
    AND p_default_value !~ '^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$'
  THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::UUID, p_stat_key;
    RETURN;
  END IF;

  IF p_field_type = 'count' THEN
    IF p_default_value IS NOT NULL
      AND (
        p_default_value !~ '^[0-9]+$'
        OR length(p_default_value) > 16
        OR p_default_value::NUMERIC > 9007199254740991
      )
    THEN
      RETURN QUERY SELECT 'invalid'::TEXT, NULL::UUID, p_stat_key;
      RETURN;
    END IF;

    IF normalized_meta ? 'default_current' THEN
      IF p_default_value IS NULL
        OR jsonb_typeof(normalized_meta -> 'default_current') <> 'number'
        OR (normalized_meta ->> 'default_current') !~ '^[0-9]+$'
        OR length(normalized_meta ->> 'default_current') > 16
        OR (normalized_meta ->> 'default_current')::NUMERIC > 9007199254740991
      THEN
        RETURN QUERY SELECT 'invalid'::TEXT, NULL::UUID, p_stat_key;
        RETURN;
      END IF;
    END IF;
  ELSIF normalized_meta ? 'default_current' THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::UUID, p_stat_key;
    RETURN;
  END IF;

  request_fingerprint := md5(
    jsonb_build_object(
      'stat_key', p_stat_key,
      'label', p_label,
      'field_type', p_field_type,
      'default_value', p_default_value,
      'is_required', normalized_is_required,
      'sort_order', normalized_sort_order,
      'meta', normalized_meta
    )::TEXT
  );

  SELECT audit.*
  INTO prior_audit
  FROM custom_stat_registration_audit audit
  WHERE audit.game_id = p_game_id
    AND audit.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF prior_audit.request_fingerprint = request_fingerprint THEN
      RETURN QUERY
      SELECT
        'existing_equivalent'::TEXT,
        prior_audit.definition_id,
        definition.stat_key
      FROM stat_template definition
      WHERE definition.id = prior_audit.definition_id;

      IF NOT FOUND THEN
        RETURN QUERY SELECT 'target_missing'::TEXT, NULL::UUID, NULL::TEXT;
      END IF;
    ELSE
      RETURN QUERY
      SELECT
        'conflict'::TEXT,
        prior_audit.definition_id,
        definition.stat_key
      FROM stat_template definition
      WHERE definition.id = prior_audit.definition_id;

      IF NOT FOUND THEN
        RETURN QUERY SELECT 'conflict'::TEXT, prior_audit.definition_id, NULL::TEXT;
      END IF;
    END IF;
    RETURN;
  END IF;

  SELECT definition.*
  INTO existing_definition
  FROM stat_template definition
  WHERE definition.game_id = p_game_id
    AND definition.stat_key = p_stat_key;

  IF FOUND THEN
    IF existing_definition.label = p_label
      AND existing_definition.field_type = p_field_type
      AND existing_definition.default_value IS NOT DISTINCT FROM p_default_value
      AND existing_definition.is_required = normalized_is_required
      AND existing_definition.sort_order = normalized_sort_order
      AND existing_definition.meta = normalized_meta
    THEN
      BEGIN
        INSERT INTO custom_stat_registration_audit (
          game_id,
          definition_id,
          actor_discord_user_id,
          idempotency_key,
          request_fingerprint,
          outcome
        )
        VALUES (
          p_game_id,
          existing_definition.id,
          p_actor_discord_user_id,
          p_idempotency_key,
          request_fingerprint,
          'existing_equivalent'
        );
      EXCEPTION WHEN unique_violation THEN
        SELECT audit.*
        INTO prior_audit
        FROM custom_stat_registration_audit audit
        WHERE audit.game_id = p_game_id
          AND audit.idempotency_key = p_idempotency_key;

        IF prior_audit.request_fingerprint IS DISTINCT FROM request_fingerprint THEN
          RETURN QUERY
          SELECT 'conflict'::TEXT, prior_audit.definition_id, definition.stat_key
          FROM stat_template definition
          WHERE definition.id = prior_audit.definition_id;
          RETURN;
        END IF;
      END;

      RETURN QUERY
      SELECT 'existing_equivalent'::TEXT, existing_definition.id, existing_definition.stat_key;
    ELSE
      RETURN QUERY
      SELECT 'conflict'::TEXT, existing_definition.id, existing_definition.stat_key;
    END IF;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO stat_template (
      game_id,
      stat_key,
      label,
      field_type,
      default_value,
      is_required,
      sort_order,
      meta
    )
    VALUES (
      p_game_id,
      p_stat_key,
      p_label,
      p_field_type,
      p_default_value,
      normalized_is_required,
      normalized_sort_order,
      normalized_meta
    )
    RETURNING * INTO created_definition;

    INSERT INTO custom_stat_registration_audit (
      game_id,
      definition_id,
      actor_discord_user_id,
      idempotency_key,
      request_fingerprint,
      outcome
    )
    VALUES (
      p_game_id,
      created_definition.id,
      p_actor_discord_user_id,
      p_idempotency_key,
      request_fingerprint,
      'created'
    );

    RETURN QUERY SELECT 'created'::TEXT, created_definition.id, created_definition.stat_key;
  EXCEPTION WHEN unique_violation THEN
    SELECT audit.*
    INTO prior_audit
    FROM custom_stat_registration_audit audit
    WHERE audit.game_id = p_game_id
      AND audit.idempotency_key = p_idempotency_key;

    IF FOUND THEN
      IF prior_audit.request_fingerprint = request_fingerprint THEN
        RETURN QUERY
        SELECT 'existing_equivalent'::TEXT, prior_audit.definition_id, definition.stat_key
        FROM stat_template definition
        WHERE definition.id = prior_audit.definition_id;
      ELSE
        RETURN QUERY
        SELECT 'conflict'::TEXT, prior_audit.definition_id, definition.stat_key
        FROM stat_template definition
        WHERE definition.id = prior_audit.definition_id;
      END IF;
      RETURN;
    END IF;

    SELECT definition.*
    INTO existing_definition
    FROM stat_template definition
    WHERE definition.game_id = p_game_id
      AND definition.stat_key = p_stat_key;

    IF FOUND
      AND existing_definition.label = p_label
      AND existing_definition.field_type = p_field_type
      AND existing_definition.default_value IS NOT DISTINCT FROM p_default_value
      AND existing_definition.is_required = normalized_is_required
      AND existing_definition.sort_order = normalized_sort_order
      AND existing_definition.meta = normalized_meta
    THEN
      INSERT INTO custom_stat_registration_audit (
        game_id,
        definition_id,
        actor_discord_user_id,
        idempotency_key,
        request_fingerprint,
        outcome
      )
      VALUES (
        p_game_id,
        existing_definition.id,
        p_actor_discord_user_id,
        p_idempotency_key,
        request_fingerprint,
        'existing_equivalent'
      );
      RETURN QUERY
      SELECT 'existing_equivalent'::TEXT, existing_definition.id, existing_definition.stat_key;
    ELSE
      RETURN QUERY
      SELECT 'conflict'::TEXT, existing_definition.id, existing_definition.stat_key;
    END IF;
  END;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION list_custom_stat_definitions(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_custom_stat_definition(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, JSONB, TEXT, TEXT
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sprite_integrations_reader') THEN
    GRANT EXECUTE ON FUNCTION list_custom_stat_definitions(UUID)
      TO sprite_integrations_reader;
    GRANT EXECUTE ON FUNCTION register_custom_stat_definition(
      UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, JSONB, TEXT, TEXT
    ) TO sprite_integrations_reader;
  END IF;
END
$$;

-- === CHARACTERS ===
CREATE TABLE character (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, -- Discord user ID
  name TEXT NOT NULL,
  avatar_url TEXT,
  rp_display_name TEXT,
  rp_display_avatar_url TEXT,
  bio TEXT,
  visibility TEXT DEFAULT 'private' CHECK (visibility IN ('private', 'public', 'link-only')),
  deleted_at TIMESTAMP,
  deleted_by_game BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- === GAME-OWNED NPCS AND CREATURES ===
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

-- === ROLEPLAY PROXY CHANNEL MODE ===
CREATE TABLE rp_channel_mode (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  is_ic BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, channel_id, user_id)
);

-- === ROLEPLAY PROXY MESSAGE OWNERSHIP ===
CREATE TABLE rp_proxy_message (
  proxy_message_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  character_id UUID REFERENCES character(id) ON DELETE SET NULL,
  webhook_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- === BOT LIFECYCLE NOTIFICATION CHANNELS ===
CREATE TABLE lifecycle_notification_channel (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
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

-- === TEMPLATE-BASED STAT FIELDS PER GAME ENTITY ===
CREATE TABLE game_entity_stat_field (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_entity_id UUID NOT NULL REFERENCES game_entity(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES stat_template(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  meta JSONB DEFAULT '{}',
  UNIQUE (game_entity_id, template_id)
);

-- === GAME ENTITY CUSTOM FIELDS ===
CREATE TABLE game_entity_custom_field (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_entity_id UUID NOT NULL REFERENCES game_entity(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  meta JSONB DEFAULT '{}',
  UNIQUE (game_entity_id, name)
);

-- === GAME ENTITY INVENTORY ===
CREATE TABLE game_entity_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_entity_id UUID NOT NULL REFERENCES game_entity(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  equipped BOOLEAN DEFAULT FALSE,
  description TEXT
);

-- === GAME ENTITY INVENTORY FIELDS ===
CREATE TABLE game_entity_inventory_field (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID NOT NULL REFERENCES game_entity_inventory(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  meta JSONB DEFAULT '{}',
  UNIQUE (inventory_id, name)
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
CREATE INDEX idx_rp_channel_mode_guild_channel ON rp_channel_mode(guild_id, channel_id);
CREATE INDEX idx_rp_proxy_message_user_id ON rp_proxy_message(user_id);
CREATE INDEX idx_rp_proxy_message_channel_id ON rp_proxy_message(channel_id);
CREATE INDEX idx_lifecycle_notification_channel_channel_id
  ON lifecycle_notification_channel(channel_id);

-- === RUNTIME INSTANCE LEASE ===
-- Used by blue-green/standby deployments so only one container owns Discord
-- gateway processing and scheduler work at a time.
CREATE TABLE runtime_instance_lease (
  lease_key TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('active', 'standby')),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_runtime_instance_lease_expires_at
  ON runtime_instance_lease(expires_at);

-- === D20 ROLL TELEMETRY ===
-- Intentionally limited to exact 1d20 rolls for distribution analysis.
CREATE TABLE d20_roll (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id TEXT NOT NULL UNIQUE,
  result SMALLINT NOT NULL CHECK (result BETWEEN 1 AND 20),
  user_id TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_d20_roll_created_at ON d20_roll(created_at);
CREATE INDEX idx_d20_roll_guild_created_at ON d20_roll(guild_id, created_at);
CREATE INDEX idx_d20_roll_channel_created_at ON d20_roll(channel_id, created_at);
CREATE INDEX idx_d20_roll_user_created_at ON d20_roll(user_id, created_at);

-- Stat lookups
CREATE INDEX idx_stat_character_id ON character_stat_field(character_id);
CREATE INDEX idx_stat_template_game_id ON stat_template(game_id);

-- Custom field lookup
CREATE INDEX idx_custom_stat_character_id ON character_custom_field(character_id);

-- Inventory lookups
CREATE INDEX idx_inventory_character_id ON character_inventory(character_id);
CREATE INDEX idx_inventory_field_inventory_id ON character_inventory_field(inventory_id);
CREATE INDEX idx_game_entity_stat_entity_id ON game_entity_stat_field(game_entity_id);
CREATE INDEX idx_game_entity_custom_entity_id ON game_entity_custom_field(game_entity_id);
CREATE INDEX idx_game_entity_inventory_entity_id ON game_entity_inventory(game_entity_id);
CREATE INDEX idx_game_entity_inventory_field_inventory_id
  ON game_entity_inventory_field(inventory_id);

-- Player-server context lookups
CREATE INDEX idx_player_server_link_player_id ON player_server_link(player_id);
CREATE INDEX idx_player_server_link_guild_id ON player_server_link(guild_id);
CREATE INDEX idx_player_server_link_player_guild ON player_server_link(player_id, guild_id);

-- === DISCORD ENTITLEMENTS CACHE (GUILD-SCOPED) ===
-- Mirrors Discord Premium App entitlements so checks are fast/reliable.
-- Source of truth remains Discord; this is a cache updated by webhooks/reconciliation.

CREATE TABLE entitlements_cache (
  entitlement_id TEXT PRIMARY KEY,                     -- Discord entitlement id
  guild_id       TEXT NOT NULL,                        -- Discord guild/server id
  sku_id         TEXT NOT NULL,                        -- Discord SKU id
  status         TEXT NOT NULL
                  CHECK (status IN ('active', 'expired', 'canceled')),
  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ,                          -- null = open-ended
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw            JSONB NOT NULL DEFAULT '{}'::jsonb    -- optional snapshot for debugging/audits
);

-- Keep updated_at fresh on changes
CREATE OR REPLACE FUNCTION update_entitlements_cache_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_entitlements_cache_updated_at
BEFORE UPDATE ON entitlements_cache
FOR EACH ROW
EXECUTE FUNCTION update_entitlements_cache_updated_at();

-- === Indexes tuned for common queries ===

-- Fast “does this guild currently have any active plan (optionally for a SKU)?”
-- Expiry is time-relative, so keep the partial predicate immutable and filter ends_at at query time.
CREATE INDEX idx_entitlements_active_guild_sku
  ON entitlements_cache (guild_id, sku_id)
  WHERE status = 'active';

-- If you often check “any active at all”, the sku_id join key isn’t needed:
CREATE INDEX idx_entitlements_active_guild
  ON entitlements_cache (guild_id)
  WHERE status = 'active';

-- Helpful for debugging/support timelines per guild:
CREATE INDEX idx_entitlements_guild_updated_at
  ON entitlements_cache (guild_id, updated_at DESC);

-- Quick lookups by SKU (e.g., analytics, migrations):
CREATE INDEX idx_entitlements_sku ON entitlements_cache (sku_id);

-- General status filter by guild (broad queries):
CREATE INDEX idx_entitlements_guild_status ON entitlements_cache (guild_id, status);

-- 001_add_gifted_guilds.sql
CREATE TABLE gifted_guilds (
  guild_id        TEXT PRIMARY KEY,                 -- Discord guild/server id
  granted_by      TEXT NOT NULL,                    -- Discord user id of granter
  recipient_member_id TEXT,                         -- optional Discord user id intended to receive support subscriber verification
  note            TEXT,                             -- optional: why/how
  expires_at      TIMESTAMPTZ,                      -- optional: null means no expiry
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helpful for auditing and pruning
CREATE INDEX IF NOT EXISTS idx_gifted_guilds_expires_at
  ON gifted_guilds (expires_at) WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gifted_guilds_recipient_member_id
  ON gifted_guilds (recipient_member_id) WHERE recipient_member_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS custom_stat_value_provenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('character', 'entity')),
  target_id UUID NOT NULL,
  template_id UUID NOT NULL REFERENCES stat_template(id) ON DELETE CASCADE,
  integration_key TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  source_stat_key TEXT NOT NULL,
  source_max_stat_key TEXT,
  source_observed_at TIMESTAMPTZ NOT NULL,
  source_revision TEXT,
  mapping_id TEXT NOT NULL,
  mapping_version TEXT NOT NULL,
  writer TEXT NOT NULL,
  actor_discord_user_id TEXT,
  prior_value JSONB NOT NULL,
  new_value JSONB NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS custom_stat_value_provenance_target_idx
  ON custom_stat_value_provenance (target_type, target_id, template_id, applied_at DESC);

CREATE INDEX IF NOT EXISTS custom_stat_value_provenance_source_idx
  ON custom_stat_value_provenance (
    integration_key,
    campaign_id,
    source_stat_key,
    mapping_id,
    mapping_version,
    source_observed_at DESC
  );

CREATE OR REPLACE FUNCTION get_custom_stat_value_state(
  p_game_id UUID,
  p_target_type TEXT,
  p_target_id UUID,
  p_template_id UUID
)
RETURNS TABLE (
  target_type TEXT,
  target_id UUID,
  template_id UUID,
  value TEXT,
  meta JSONB,
  provenance JSONB
) AS $$
BEGIN
  IF p_target_type = 'character' THEN
    RETURN QUERY
    SELECT
      p_target_type,
      p_target_id,
      p_template_id,
      field.value,
      COALESCE(field.meta, '{}'::JSONB),
      COALESCE(to_jsonb(prov), '{}'::JSONB)
    FROM character target
    JOIN stat_template definition
      ON definition.id = p_template_id
     AND definition.game_id = p_game_id
    LEFT JOIN character_stat_field field
      ON field.character_id = target.id
     AND field.template_id = definition.id
    LEFT JOIN LATERAL (
      SELECT history.*
      FROM custom_stat_value_provenance history
      WHERE history.target_type = p_target_type
        AND history.target_id = p_target_id
        AND history.template_id = p_template_id
      ORDER BY history.applied_at DESC, history.id DESC
      LIMIT 1
    ) prov ON TRUE
    WHERE target.id = p_target_id
      AND target.game_id = p_game_id
      AND target.deleted_at IS NULL;
  ELSIF p_target_type = 'entity' THEN
    RETURN QUERY
    SELECT
      p_target_type,
      p_target_id,
      p_template_id,
      field.value,
      COALESCE(field.meta, '{}'::JSONB),
      COALESCE(to_jsonb(prov), '{}'::JSONB)
    FROM game_entity target
    JOIN stat_template definition
      ON definition.id = p_template_id
     AND definition.game_id = p_game_id
    LEFT JOIN game_entity_stat_field field
      ON field.game_entity_id = target.id
     AND field.template_id = definition.id
    LEFT JOIN LATERAL (
      SELECT history.*
      FROM custom_stat_value_provenance history
      WHERE history.target_type = p_target_type
        AND history.target_id = p_target_id
        AND history.template_id = p_template_id
      ORDER BY history.applied_at DESC, history.id DESC
      LIMIT 1
    ) prov ON TRUE
    WHERE target.id = p_target_id
      AND target.game_id = p_game_id
      AND target.deleted_at IS NULL;
  END IF;
END;
$$ LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION apply_custom_stat_value(
  p_game_id UUID,
  p_target_type TEXT,
  p_target_id UUID,
  p_template_id UUID,
  p_value TEXT,
  p_meta JSONB,
  p_integration_key TEXT,
  p_campaign_id TEXT,
  p_source_stat_key TEXT,
  p_source_max_stat_key TEXT,
  p_source_observed_at TIMESTAMPTZ,
  p_source_revision TEXT,
  p_mapping_id TEXT,
  p_mapping_version TEXT,
  p_writer TEXT,
  p_actor_discord_user_id TEXT
)
RETURNS TABLE (
  outcome TEXT,
  prior_value JSONB,
  new_value JSONB,
  provenance_id UUID
) AS $$
DECLARE
  definition stat_template%ROWTYPE;
  existing_value TEXT;
  existing_meta JSONB := '{}'::JSONB;
  normalized_meta JSONB := COALESCE(p_meta, '{}'::JSONB);
  merged_meta JSONB;
  canonical_prior JSONB;
  canonical_new JSONB;
  latest_provenance custom_stat_value_provenance%ROWTYPE;
  inserted_provenance_id UUID;
BEGIN
  IF p_target_type NOT IN ('character', 'entity')
    OR p_integration_key IS NULL OR btrim(p_integration_key) = ''
    OR p_campaign_id IS NULL OR btrim(p_campaign_id) = ''
    OR p_source_stat_key IS NULL OR btrim(p_source_stat_key) = ''
    OR p_source_observed_at IS NULL
    OR p_mapping_id IS NULL OR btrim(p_mapping_id) = ''
    OR p_mapping_version IS NULL OR btrim(p_mapping_version) = ''
    OR p_writer IS NULL OR btrim(p_writer) = ''
    OR jsonb_typeof(normalized_meta) <> 'object'
  THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::JSONB, NULL::JSONB, NULL::UUID;
    RETURN;
  END IF;

  SELECT st.*
  INTO definition
  FROM stat_template st
  JOIN game g ON g.id = st.game_id
  WHERE st.id = p_template_id
    AND st.game_id = p_game_id
    AND g.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'target_missing'::TEXT, NULL::JSONB, NULL::JSONB, NULL::UUID;
    RETURN;
  END IF;

  IF p_target_type = 'character' THEN
    PERFORM 1
    FROM character target
    WHERE target.id = p_target_id
      AND target.game_id = p_game_id
      AND target.deleted_at IS NULL
    FOR UPDATE;
  ELSE
    PERFORM 1
    FROM game_entity target
    WHERE target.id = p_target_id
      AND target.game_id = p_game_id
      AND target.deleted_at IS NULL
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'target_missing'::TEXT, NULL::JSONB, NULL::JSONB, NULL::UUID;
    RETURN;
  END IF;

  IF p_target_type = 'character' THEN
    SELECT field.value, COALESCE(field.meta, '{}'::JSONB)
    INTO existing_value, existing_meta
    FROM character_stat_field field
    WHERE field.character_id = p_target_id
      AND field.template_id = p_template_id;
  ELSE
    SELECT field.value, COALESCE(field.meta, '{}'::JSONB)
    INTO existing_value, existing_meta
    FROM game_entity_stat_field field
    WHERE field.game_entity_id = p_target_id
      AND field.template_id = p_template_id;
  END IF;

  existing_meta := COALESCE(existing_meta, '{}'::JSONB);
  merged_meta := existing_meta || normalized_meta;

  IF definition.field_type = 'number'
    AND (p_value IS NULL OR p_value !~ '^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$')
  THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::JSONB, NULL::JSONB, NULL::UUID;
    RETURN;
  ELSIF definition.field_type IN ('short', 'paragraph') AND p_value IS NULL THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::JSONB, NULL::JSONB, NULL::UUID;
    RETURN;
  ELSIF definition.field_type = 'count' THEN
    IF p_value IS NOT NULL
      OR NOT (normalized_meta ? 'current' OR normalized_meta ? 'max')
      OR (merged_meta ? 'current' AND (
        jsonb_typeof(merged_meta -> 'current') <> 'number'
        OR (merged_meta ->> 'current') !~ '^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$'
      ))
      OR (merged_meta ? 'max' AND (
        jsonb_typeof(merged_meta -> 'max') <> 'number'
        OR (merged_meta ->> 'max') !~ '^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$'
      ))
    THEN
      RETURN QUERY SELECT 'invalid'::TEXT, NULL::JSONB, NULL::JSONB, NULL::UUID;
      RETURN;
    END IF;
  END IF;

  canonical_prior := jsonb_build_object(
    'value', existing_value,
    'meta', existing_meta
  );
  canonical_new := jsonb_build_object(
    'value', CASE WHEN definition.field_type = 'count' THEN existing_value ELSE p_value END,
    'meta', merged_meta
  );

  SELECT history.*
  INTO latest_provenance
  FROM custom_stat_value_provenance history
  WHERE history.game_id = p_game_id
    AND history.target_type = p_target_type
    AND history.target_id = p_target_id
    AND history.template_id = p_template_id
    AND history.integration_key = p_integration_key
    AND history.campaign_id = p_campaign_id
    AND history.source_stat_key = p_source_stat_key
    AND history.mapping_id = p_mapping_id
    AND history.mapping_version = p_mapping_version
  ORDER BY history.source_observed_at DESC, history.applied_at DESC, history.id DESC
  LIMIT 1;

  IF FOUND THEN
    IF p_source_revision IS NOT NULL
      AND latest_provenance.source_revision = p_source_revision
    THEN
      IF latest_provenance.new_value = canonical_new THEN
        RETURN QUERY
        SELECT 'unchanged'::TEXT, canonical_prior, canonical_new, latest_provenance.id;
      ELSE
        RETURN QUERY
        SELECT 'conflict'::TEXT, canonical_prior, canonical_new, latest_provenance.id;
      END IF;
      RETURN;
    END IF;

    IF p_source_observed_at < latest_provenance.source_observed_at THEN
      RETURN QUERY SELECT 'stale'::TEXT, canonical_prior, canonical_new, latest_provenance.id;
      RETURN;
    ELSIF p_source_observed_at = latest_provenance.source_observed_at THEN
      IF latest_provenance.new_value = canonical_new THEN
        RETURN QUERY
        SELECT 'unchanged'::TEXT, canonical_prior, canonical_new, latest_provenance.id;
      ELSE
        RETURN QUERY
        SELECT 'conflict'::TEXT, canonical_prior, canonical_new, latest_provenance.id;
      END IF;
      RETURN;
    END IF;
  END IF;

  IF canonical_prior <> canonical_new AND p_target_type = 'character' THEN
    INSERT INTO character_stat_field (character_id, template_id, value, meta)
    VALUES (
      p_target_id,
      p_template_id,
      COALESCE(canonical_new ->> 'value', ''),
      canonical_new -> 'meta'
    )
    ON CONFLICT (character_id, template_id)
    DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta;
  ELSIF canonical_prior <> canonical_new THEN
    INSERT INTO game_entity_stat_field (game_entity_id, template_id, value, meta)
    VALUES (
      p_target_id,
      p_template_id,
      COALESCE(canonical_new ->> 'value', ''),
      canonical_new -> 'meta'
    )
    ON CONFLICT (game_entity_id, template_id)
    DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta;
  END IF;

  INSERT INTO custom_stat_value_provenance (
    game_id,
    target_type,
    target_id,
    template_id,
    integration_key,
    campaign_id,
    source_stat_key,
    source_max_stat_key,
    source_observed_at,
    source_revision,
    mapping_id,
    mapping_version,
    writer,
    actor_discord_user_id,
    prior_value,
    new_value
  )
  VALUES (
    p_game_id,
    p_target_type,
    p_target_id,
    p_template_id,
    p_integration_key,
    p_campaign_id,
    p_source_stat_key,
    p_source_max_stat_key,
    p_source_observed_at,
    p_source_revision,
    p_mapping_id,
    p_mapping_version,
    p_writer,
    p_actor_discord_user_id,
    canonical_prior,
    canonical_new
  )
  RETURNING id INTO inserted_provenance_id;

  RETURN QUERY
  SELECT
    CASE WHEN canonical_prior = canonical_new THEN 'unchanged' ELSE 'written' END::TEXT,
    canonical_prior,
    canonical_new,
    inserted_provenance_id;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION get_custom_stat_value_state(UUID, TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_custom_stat_value(
  UUID, TEXT, UUID, UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT,
  TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sprite_integrations_reader') THEN
    GRANT EXECUTE ON FUNCTION get_custom_stat_value_state(UUID, TEXT, UUID, UUID)
      TO sprite_integrations_reader;
    GRANT EXECUTE ON FUNCTION apply_custom_stat_value(
      UUID, TEXT, UUID, UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT,
      TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT
    ) TO sprite_integrations_reader;
  END IF;
END
$$;
