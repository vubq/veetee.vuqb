CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.retention_delete_job (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  conversation_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 3),
  requested_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  UNIQUE (owner_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS retention_delete_job_owner_requested_idx
  ON {{VEETEE_SCHEMA}}.retention_delete_job (owner_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.conversation_tombstone (
  conversation_id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  deleted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (reason IN ('owner_request', 'retention_expired')),
  delete_job_id uuid REFERENCES {{VEETEE_SCHEMA}}.retention_delete_job(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS conversation_tombstone_expiry_idx
  ON {{VEETEE_SCHEMA}}.conversation_tombstone (expires_at);
