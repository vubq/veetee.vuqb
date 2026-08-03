-- Conversation history read model. Raw audio is deliberately not represented
-- in this migration; the baseline captures transcript metadata only.

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.retention_policy (
  owner_id text PRIMARY KEY,
  capture_transcript boolean NOT NULL,
  transcript_days integer CHECK (transcript_days IS NULL OR transcript_days BETWEEN 1 AND 3650),
  capture_audio boolean NOT NULL DEFAULT false CHECK (capture_audio = false),
  audio_days integer CHECK (audio_days IS NULL),
  effective_at timestamptz NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  etag text NOT NULL,
  CHECK (capture_transcript OR transcript_days IS NULL)
);

INSERT INTO {{VEETEE_SCHEMA}}.retention_policy
  (owner_id, capture_transcript, transcript_days, capture_audio, audio_days, effective_at, revision, etag)
VALUES
  ('local-owner', true, 30, false, NULL, '1970-01-01T00:00:00Z', 1,
   '"baseline-transcript-30d-audio-off"')
ON CONFLICT (owner_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.conversation (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  assistant_id uuid NOT NULL REFERENCES {{VEETEE_SCHEMA}}.assistant(id) ON DELETE CASCADE,
  device_key text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  locale text NOT NULL,
  config_revision integer NOT NULL CHECK (config_revision > 0),
  status text NOT NULL CHECK (status IN ('active', 'completed', 'aborted', 'error')),
  turn_count integer NOT NULL CHECK (turn_count >= 0),
  last_turn_at timestamptz,
  aggregate_timings jsonb NOT NULL CHECK (jsonb_typeof(aggregate_timings) = 'object'),
  retention_until timestamptz
);

CREATE INDEX IF NOT EXISTS conversation_owner_assistant_started_idx
  ON {{VEETEE_SCHEMA}}.conversation (owner_id, assistant_id, started_at DESC, id);

CREATE TABLE IF NOT EXISTS {{VEETEE_SCHEMA}}.conversation_turn (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES {{VEETEE_SCHEMA}}.conversation(id) ON DELETE CASCADE,
  turn_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  state text NOT NULL CHECK (state IN ('completed', 'aborted', 'error')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  finish_reason text NOT NULL,
  timings jsonb NOT NULL CHECK (jsonb_typeof(timings) = 'object'),
  transcript jsonb NOT NULL CHECK (jsonb_typeof(transcript) = 'array'),
  tool_calls jsonb NOT NULL CHECK (jsonb_typeof(tool_calls) = 'array'),
  UNIQUE (conversation_id, turn_id),
  UNIQUE (conversation_id, sequence)
);

CREATE INDEX IF NOT EXISTS conversation_turn_conversation_sequence_idx
  ON {{VEETEE_SCHEMA}}.conversation_turn (conversation_id, sequence);
