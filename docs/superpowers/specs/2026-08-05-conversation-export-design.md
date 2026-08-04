# Conversation export design

## Status

Accepted for the M2 host/control-plane slice — 2026-08-05

## Context

Q-009 in `docs/11-open-questions.md` requires the local Owner to be able to
export retained transcript data while audio capture remains disabled. The
current History view can read a conversation but has no explicit download
contract. Export must not leak device identity hashes, secret references,
provider credentials, raw audio or ORM-only fields.

## Options

### A — Single-conversation JSON attachment (chosen)

Add `GET /api/v1/conversations/{id}/export`. The Manager API reuses the
owner/retention-scoped conversation read, maps an explicit export allow-list,
and sends `Content-Disposition: attachment`. The Web renders a `VtButton` and
downloads the returned JSON without persisting it in application state.

- Pros: bounded response, simple retry/error semantics, no new worker/storage,
  works for both InMemory and PostgreSQL stores.
- Cons: exporting a whole assistant requires one download per conversation;
  browser handles the final file write.

### B — Full assistant archive job

Create an async archive job and object-store artifact for all conversations.

- Pros: convenient for large exports and future backup workflows.
- Cons: requires job persistence, progress/retry/tombstone semantics and an
  additional storage contract; not needed for the M2 local baseline.

### C — Browser-only reuse of the detail GET

Fetch the existing detail response and download it directly from the Web.

- Pros: no new API route.
- Cons: couples export format to read response, risks leaking fields added to
  the detail schema, and does not provide a stable privacy allow-list.

## Decision

Choose A for M2. Export is one retained conversation per request and returns
only this shape:

```text
{
  exportVersion: 1,
  exportedAt: ISO timestamp,
  conversation: {
    summary: summary without deviceKey,
    turns: transcript/tool/timing fields already retained,
    retention: effective owner policy
  }
}
```

The endpoint applies the same owner scope and retention visibility as the read
endpoint. Expired or unknown conversations return the existing typed 404
boundary. Audio stays absent because the baseline rejects audio retention.
Delete remains a separate async-retention-job decision and is not silently
implemented by this slice.

## Component boundaries

- Manager API: explicit `conversationExportSchema` and a small export mapper;
  no raw Store/ORM object is serialized.
- HTTP gateway: typed `exportConversation()` method returning the export view.
- History feature: `ConversationExportButton` is kept as a focused child; the
  route owns the download side effect and shows loading/error feedback.
- Mock gateway: deterministic export fixture, never a production network call.

## Verification

- API InMemory + PostgreSQL tests prove owner scope, retention visibility,
  `Content-Disposition`, version field and absent `deviceKey`.
- Web unit tests prove typed gateway mapping, button loading/error and that the
  browser download does not put export data into Pinia/localStorage.
- Chromium E2E checks the History export action in preview mode.
- No audio device, ESP32 serial, firmware flash, Wi-Fi or production database
  is touched.

## Supersede condition

Replace this ADR/spec with an archive-job ADR when Owner requests bulk export,
exports exceed a bounded single-conversation response, or an object-store
privacy contract is accepted.
