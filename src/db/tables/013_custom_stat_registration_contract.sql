CREATE TABLE IF NOT EXISTS custom_stat_registration_audit (
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
