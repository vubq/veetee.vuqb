ALTER TABLE {{VEETEE_SCHEMA}}.provider_config
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS provider_config_owner_name_active_unique
  ON {{VEETEE_SCHEMA}}.provider_config (owner_id, lower(name))
  WHERE archived_at IS NULL;
