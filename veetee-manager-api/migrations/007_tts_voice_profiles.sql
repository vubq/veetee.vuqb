-- User-managed TTS voices. Built-in voices continue to come from the
-- provider installation manifest; this table stores only custom profiles.
CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.voice_profile (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  provider_config_id uuid NOT NULL REFERENCES {{VEETEE_SCHEMA}}.provider_config(id) ON DELETE CASCADE,
  name text NOT NULL,
  locale text NOT NULL,
  voice_code text NOT NULL,
  description text NOT NULL DEFAULT '',
  demo_url text,
  enabled boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0 CHECK (sort >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  etag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS voice_profile_active_code_unique
  ON {{VEETEE_SCHEMA}}.voice_profile (owner_id, provider_config_id, voice_code)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS voice_profile_owner_locale_sort_idx
  ON {{VEETEE_SCHEMA}}.voice_profile (owner_id, locale, sort, name)
  WHERE archived_at IS NULL;
