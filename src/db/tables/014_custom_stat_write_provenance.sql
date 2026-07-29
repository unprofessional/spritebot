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
