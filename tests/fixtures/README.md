# Fixtures

Real payloads recorded from live AssemblyAI sessions, one message per file, verbatim except that
audio is stripped: `reply.audio.data` becomes `data_len` plus a 32-character `data_head`, and
outgoing `input.audio` keeps only `audio_len`. No audio is stored anywhere in this repo.

## How they are recorded

1. `pnpm fixtures:wav` renders `golden-draft.wav` (16 kHz mono PCM16, about 80 s) from the
   golden-path script in `prd.md` section 5 with the offline Windows voices David (advisor) and
   Zira (customer). Synthetic speech, not a recording of people.
2. `SAAKSHI_LIVE_E2E=1 SAAKSHI_FAKE_WAV=tests/fixtures/golden-draft.wav SAAKSHI_LIVE_HOLD_MS=90000 pnpm test:e2e tests/e2e/dual-session.live.spec.ts`
   runs the spike page against live AssemblyAI with the WAV as Chromium's fake microphone and
   writes every WebSocket frame (audio stripped) to `test-results/ws-frames.json`.
3. `pnpm fixtures:split` picks the first frame of each shape into `stt/` and `agent/`.

`tests/unit/fixtures.test.ts` loads every file through the Zod schemas in `lib/aai/types.ts`, so a
schema that drifts from the wire fails the unit suite.

## Not captured yet

`agent/tool-call.json`, `agent/session-error.json`, `agent/out-reply-create.json` and
`agent/out-conversation-message.json` need the Phase 2 and 3 flows (tools, reply.create).
