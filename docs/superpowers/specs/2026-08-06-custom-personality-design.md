# Custom personality configuration

## Context

The assistant role snapshot already carries a `personality` object and the
Manager API preserves additive properties. The Manager Web currently exposes a
preset selector, but choosing the custom option does not provide fields for a
name or personality instructions. This makes the advertised configurable
personality capability incomplete.

## Decision

Keep personality data inside the existing role snapshot. Add one optional
`personalityPrompt` field to the Web domain draft, mapped to
`personality.prompt` at the HTTP/mock gateway boundary. No new database table,
route, provider, firmware field, or runtime fallback is required.

The role form will:

1. Keep the existing preset options.
2. Treat an unknown/missing preset id as a custom profile without discarding
   its current name or prompt.
3. Show a display-name input and instruction textarea for the custom profile.
4. Validate a non-empty name (1–80 characters) and prompt (1–4,000
   characters) before saving.
5. Send `personality: { id, name, prompt }` while preserving all other role
   policy fields and ETag/publish behavior.

Legacy snapshots without `prompt` remain readable and save safely; the prompt
is represented as an empty editable value until the owner supplies one.

## Component boundary

The existing `RoleConfigFeature` remains the orchestration surface. It reuses
the shared `VtSelect`, `VtInput`, `VtTextArea`, and `VtFormField` primitives for
the personality section. No new global component or visual token is needed.

## Verification

- Gateway unit test maps `personality.prompt` in both directions.
- Role form unit test selects custom, edits name/prompt, and asserts the save
  payload.
- Existing additive-policy, typecheck, lint, production build, and Chromium
  E2E tests remain green.
- No audio, microphone, speaker, Wi-Fi, firmware flash, or network mutation is
  part of this change.

