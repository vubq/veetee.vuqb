-- Replace the previous Veetee-specific model catalog with the source schema.
-- Runtime provider_config/assistant tables are deliberately not touched.

DROP TABLE IF EXISTS {{VEETEE_SCHEMA}}.ai_model_config CASCADE;
DROP TABLE IF EXISTS {{VEETEE_SCHEMA}}.ai_model_provider CASCADE;

CREATE TABLE {{VEETEE_SCHEMA}}.ai_model_provider (
  id varchar(32) PRIMARY KEY,
  model_type varchar(20),
  provider_code varchar(50),
  name varchar(50),
  fields jsonb,
  sort integer DEFAULT 0,
  creator bigint,
  create_date timestamp,
  updater bigint,
  update_date timestamp
);

CREATE INDEX ai_model_provider_model_type_idx
  ON {{VEETEE_SCHEMA}}.ai_model_provider (model_type);

CREATE TABLE {{VEETEE_SCHEMA}}.ai_model_config (
  id varchar(32) PRIMARY KEY,
  model_type varchar(20),
  model_code varchar(50),
  model_name varchar(50),
  is_default smallint DEFAULT 0,
  is_enabled smallint DEFAULT 0,
  config_json jsonb,
  doc_link varchar(200),
  remark text,
  sort integer DEFAULT 0,
  updater bigint,
  update_date timestamp,
  creator bigint,
  create_date timestamp
);

CREATE INDEX ai_model_config_model_type_idx
  ON {{VEETEE_SCHEMA}}.ai_model_config (model_type);

CREATE TABLE {{VEETEE_SCHEMA}}.ai_tts_voice (
  id varchar(32) PRIMARY KEY,
  tts_model_id varchar(32),
  name varchar(20),
  tts_voice varchar(50),
  languages varchar(50),
  voice_demo varchar(500),
  remark varchar(255),
  reference_audio varchar(500),
  reference_text varchar(500),
  sort integer DEFAULT 0,
  creator bigint,
  create_date timestamp,
  updater bigint,
  update_date timestamp
);

CREATE INDEX ai_tts_voice_model_idx
  ON {{VEETEE_SCHEMA}}.ai_tts_voice (tts_model_id);
