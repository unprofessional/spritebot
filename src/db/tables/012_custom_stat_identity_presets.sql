ALTER TABLE game
  ADD COLUMN IF NOT EXISTS preset_key TEXT,
  ADD COLUMN IF NOT EXISTS preset_version INTEGER;

ALTER TABLE stat_template
  ADD COLUMN IF NOT EXISTS stat_key TEXT;

DO $$
DECLARE
  template RECORD;
  normalized_key TEXT;
  candidate_key TEXT;
  suffix INTEGER;
BEGIN
  FOR template IN
    SELECT id, game_id, label
    FROM stat_template
    WHERE stat_key IS NULL
    ORDER BY game_id, lower(label), label, id
  LOOP
    normalized_key := trim(BOTH '_' FROM regexp_replace(lower(template.label), '[^a-z0-9]+', '_', 'g'));
    IF normalized_key = '' THEN
      normalized_key := 'stat';
    ELSIF normalized_key !~ '^[a-z]' THEN
      normalized_key := 'stat_' || normalized_key;
    END IF;
    normalized_key := left(normalized_key, 64);
    candidate_key := normalized_key;
    suffix := 2;

    WHILE EXISTS (
      SELECT 1
      FROM stat_template existing
      WHERE existing.game_id = template.game_id
        AND lower(existing.stat_key) = lower(candidate_key)
    ) LOOP
      candidate_key := left(normalized_key, 64 - length(suffix::text) - 1) || '_' || suffix;
      suffix := suffix + 1;
    END LOOP;

    UPDATE stat_template
    SET stat_key = candidate_key
    WHERE id = template.id;
  END LOOP;
END
$$;

ALTER TABLE stat_template
  ALTER COLUMN stat_key SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stat_template_stat_key_format_check'
  ) THEN
    ALTER TABLE stat_template
      ADD CONSTRAINT stat_template_stat_key_format_check
      CHECK (stat_key ~ '^[a-z][a-z0-9_]{0,63}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'game_preset_selection_check'
  ) THEN
    ALTER TABLE game
      ADD CONSTRAINT game_preset_selection_check
      CHECK (
        (preset_key IS NULL AND preset_version IS NULL)
        OR (
          preset_key ~ '^[a-z][a-z0-9_]{0,63}$'
          AND preset_version IS NOT NULL
          AND preset_version > 0
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stat_template_game_stat_key_unique'
  ) THEN
    ALTER TABLE stat_template
      ADD CONSTRAINT stat_template_game_stat_key_unique
      UNIQUE (game_id, stat_key);
  END IF;
END
$$;

DROP INDEX IF EXISTS stat_template_game_stat_key_uidx;

CREATE OR REPLACE FUNCTION prevent_stat_template_key_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stat_key IS DISTINCT FROM OLD.stat_key THEN
    RAISE EXCEPTION 'stat_template.stat_key is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stat_template_key_immutable ON stat_template;
CREATE TRIGGER stat_template_key_immutable
BEFORE UPDATE OF stat_key ON stat_template
FOR EACH ROW
EXECUTE FUNCTION prevent_stat_template_key_change();
