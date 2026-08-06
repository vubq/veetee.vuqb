-- Replace the previous Veetee-specific provider fixtures with the source-shaped
-- model/provider catalog. Runtime provider_config and conversation tables are
-- intentionally untouched: they are the wire/runtime compatibility boundary,
-- not the Manager model catalog.

DELETE FROM {{VEETEE_SCHEMA}}.ai_model_config;
DELETE FROM {{VEETEE_SCHEMA}}.ai_model_provider;
