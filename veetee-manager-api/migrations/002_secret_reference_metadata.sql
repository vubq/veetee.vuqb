ALTER TABLE {{VEETEE_SCHEMA}}.secret_reference
  ADD COLUMN IF NOT EXISTS metadata_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS etag text NOT NULL DEFAULT '';

UPDATE {{VEETEE_SCHEMA}}.secret_reference
SET etag = md5(id::text || ':' || name || ':' || metadata_revision)
WHERE etag = '';

CREATE INDEX IF NOT EXISTS secret_reference_owner_updated_idx
  ON {{VEETEE_SCHEMA}}.secret_reference (owner_id, updated_at DESC, id);
