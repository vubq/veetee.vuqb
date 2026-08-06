-- Source-aligned provider/model management. This schema is isolated from the
-- realtime provider_config tables so the tested conversation runtime is not
-- changed while Manager Web moves to the new control-plane mental model.

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.ai_model_provider (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  model_type text NOT NULL CHECK (model_type IN ('ASR','TTS','LLM','VLLM','Intent','Memory','VAD','Plugin','RAG')),
  provider_code text NOT NULL,
  name text NOT NULL,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fields) = 'array'),
  sort integer NOT NULL DEFAULT 0 CHECK (sort >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  etag text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, model_type, provider_code)
);

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.ai_model_config (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  model_type text NOT NULL CHECK (model_type IN ('ASR','TTS','LLM','VLLM','Intent','Memory','VAD','Plugin','RAG')),
  model_code text NOT NULL,
  model_name text NOT NULL,
  provider_code text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config_json) = 'object'),
  doc_link text,
  remark text,
  sort integer NOT NULL DEFAULT 0 CHECK (sort >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  etag text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, model_type, model_code),
  FOREIGN KEY (owner_id, model_type, provider_code)
    REFERENCES {{VEETEE_SCHEMA}}.ai_model_provider(owner_id, model_type, provider_code)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ai_model_provider_owner_type_sort_idx
  ON {{VEETEE_SCHEMA}}.ai_model_provider (owner_id, model_type, sort, name);

CREATE INDEX IF NOT EXISTS ai_model_config_owner_type_sort_idx
  ON {{VEETEE_SCHEMA}}.ai_model_config (owner_id, model_type, sort, model_name);

CREATE UNIQUE INDEX IF NOT EXISTS ai_model_config_one_default_per_type_idx
  ON {{VEETEE_SCHEMA}}.ai_model_config (owner_id, model_type)
  WHERE is_default;
