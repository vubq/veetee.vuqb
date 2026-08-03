-- Veetee control-plane baseline. The migration runner replaces
-- {{VEETEE_SCHEMA}} with a validated identifier before execution.

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.assistant (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  name text NOT NULL,
  draft_revision integer NOT NULL CHECK (draft_revision > 0),
  draft_etag text NOT NULL,
  published_revision integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.assistant_revision (
  assistant_id uuid NOT NULL REFERENCES {{VEETEE_SCHEMA}}.assistant(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  role jsonb NOT NULL CHECK (jsonb_typeof(role) = 'object'),
  provider_selections jsonb NOT NULL CHECK (jsonb_typeof(provider_selections) = 'object'),
  etag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assistant_id, revision)
);

CREATE INDEX IF NOT EXISTS assistant_owner_updated_idx
  ON {{VEETEE_SCHEMA}}.assistant (owner_id, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.provider_config (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  installation_id text NOT NULL,
  name text NOT NULL,
  current_revision integer NOT NULL CHECK (current_revision > 0),
  current_etag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.provider_config_revision (
  provider_config_id uuid NOT NULL REFERENCES {{VEETEE_SCHEMA}}.provider_config(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  secret_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(secret_refs) = 'array'),
  etag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_config_id, revision)
);

CREATE INDEX IF NOT EXISTS provider_config_owner_installation_idx
  ON {{VEETEE_SCHEMA}}.provider_config (owner_id, installation_id, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.runtime_publication (
  assistant_id uuid PRIMARY KEY REFERENCES {{VEETEE_SCHEMA}}.assistant(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  etag text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (assistant_id, revision)
    REFERENCES {{VEETEE_SCHEMA}}.assistant_revision(assistant_id, revision)
);

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.secret_reference (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  name text NOT NULL,
  store text NOT NULL,
  locator_masked text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('available', 'unavailable', 'revoked')),
  last_rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.provider_secret_binding (
  provider_config_id uuid NOT NULL,
  config_revision integer NOT NULL,
  field text NOT NULL,
  secret_reference_id uuid NOT NULL REFERENCES {{VEETEE_SCHEMA}}.secret_reference(id) ON DELETE RESTRICT,
  secret_version integer NOT NULL CHECK (secret_version > 0),
  PRIMARY KEY (provider_config_id, config_revision, field),
  FOREIGN KEY (provider_config_id, config_revision)
    REFERENCES {{VEETEE_SCHEMA}}.provider_config_revision(provider_config_id, revision)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.manager_session (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS manager_session_active_idx
  ON {{VEETEE_SCHEMA}}.manager_session (owner_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.audit_event (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  request_id text,
  diff jsonb NOT NULL CHECK (jsonb_typeof(diff) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_event_owner_created_idx
  ON {{VEETEE_SCHEMA}}.audit_event (owner_id, created_at DESC, id);
