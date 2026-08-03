CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.device (
  id uuid PRIMARY KEY,
  owner_id text,
  assistant_id uuid REFERENCES {{VEETEE_SCHEMA}}.assistant(id) ON DELETE SET NULL,
  identity_hash text NOT NULL,
  client_id_hash text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  masked_mac text NOT NULL,
  firmware_version text NOT NULL,
  board text NOT NULL,
  online_state text NOT NULL CHECK (online_state IN ('online', 'offline')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_conversation_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_hash, client_id_hash)
);

CREATE INDEX IF NOT EXISTS device_owner_assistant_idx
  ON {{VEETEE_SCHEMA}}.device (owner_id, assistant_id, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.pairing_challenge (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES {{VEETEE_SCHEMA}}.device(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'used', 'expired')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS pairing_challenge_code_state_idx
  ON {{VEETEE_SCHEMA}}.pairing_challenge (code_hash, state, expires_at);
