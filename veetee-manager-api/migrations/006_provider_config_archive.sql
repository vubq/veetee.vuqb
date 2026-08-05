ALTER TABLE {{VEETEE_SCHEMA}}.provider_config
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS provider_config_active_owner_name_idx
  ON {{VEETEE_SCHEMA}}.provider_config (owner_id, name)
  WHERE archived_at IS NULL;
