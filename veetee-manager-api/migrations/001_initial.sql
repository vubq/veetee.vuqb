CREATE TABLE IF NOT EXISTS assistant (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  name text NOT NULL,
  draft_revision jsonb NOT NULL,
  published_revision jsonb,
  etag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_config (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  installation_id text NOT NULL,
  name text NOT NULL,
  revision integer NOT NULL,
  config jsonb NOT NULL,
  secret_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  etag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runtime_publication (
  id integer PRIMARY KEY CHECK (id = 1),
  snapshot jsonb NOT NULL,
  revision integer NOT NULL,
  etag text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
