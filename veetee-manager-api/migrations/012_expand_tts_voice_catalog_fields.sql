-- Keep the source-aligned voice table shape while allowing the Manager UI's
-- validated display names, locale lists and provider metadata to be edited
-- without a database-level truncation failure.
ALTER TABLE {{VEETEE_SCHEMA}}.ai_tts_voice
  ALTER COLUMN name TYPE varchar(120),
  ALTER COLUMN tts_voice TYPE varchar(160),
  ALTER COLUMN languages TYPE varchar(160),
  ALTER COLUMN voice_demo TYPE varchar(2048),
  ALTER COLUMN reference_audio TYPE varchar(2048),
  ALTER COLUMN reference_text TYPE varchar(4000);
