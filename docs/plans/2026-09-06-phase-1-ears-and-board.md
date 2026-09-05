# Phase 1 plan: Ears and the Checkpoint Board (Sep 6 to 11, 2026)

**Goal:** a live two-speaker transcript with roles, and a rule engine that ticks the ULIP
checkpoints and flags violations on the rehearsed script, on the deployed URL.

**Spec:** `prd.md` P0-1 to P0-4, `trd.md` sections 2, 4, 6.1, 10, 13; `docs/KICKOFF-PROMPT.md`
Phase 1; verified wire facts in `docs/decisions.md`. Owner commits and pushes; I report
"ready to commit" per task.

## Design decisions carried from Phase 0 evidence

- Calibration binds by spoken name first (the setup form knows both names), then falls back to
  speaking order for turns without a name; PENDING turns never bind. Prompts ask for a full
  sentence. Manual assign and Swap always available. Superseded the order-first rule after the
  second recording labelled the customer A and lost the advisor first line.
- The Mouth speaks only through `reply.create` instructions; no `conversation.message` (S4).
  In Phase 1 the Mouth speaks the greeting and two calibration prompts, then stays silent. The
  mic never reaches the Mouth in Phase 1 (gate table: CALIBRATE and OBSERVE are off).
- Rule matching runs on normalised text (NFC, lower case, punctuation to spaces, digits kept,
  Devanagari combining marks kept) and on a two-turn window; a windowed match counts only if it
  ends inside the current turn. Checkpoints tick on advisor turns only; a prohibited match on a
  customer turn is recorded as a customer belief.
- `Turn.language_code` is a display tag; the transcript shows `hi+en` when a turn mixes scripts.
- On STT reconnect, turn orders continue from the last seen order plus one and a `gap` is
  recorded (needed by the certificate in Phase 3).

## Files

```
lib/rules/pack.ts          Zod schema, compilePack (regex compile, id uniqueness)
lib/rules/normalise.ts     normalise(text)
lib/rules/engine.ts        evaluateTurn(pack, turn, prev)
lib/rules/load.ts          getPack(id) from packs/*.json
packs/insurance-ulip-in.json  v1.0.0: 8 checkpoints, 6 prohibited, 7 teach-back topics, demo script
lib/session/transcript.ts  turn store reducer (partials, finals, revisions, roles, language tag)
lib/session/roles.ts       calibration state machine, swap, manual assign
lib/session/machine.ts     phase reducer + audio gate table (Phase 1 transitions; Phase 2 adds the rest)
lib/session/board.ts       checkpoint and violation state from rule matches
lib/session/keyterms.ts    keyterms and STT prompt from setup plus pack
lib/session/store.ts       Zustand store for the room
lib/session/controller.ts  orchestrates capture, Ears, Mouth, rules, store (replaces lib/spike)
lib/aai/socket.ts          typed WebSocket wrapper with injectable constructor
lib/aai/ears.ts            Streaming STT client: connect, audio, UpdateConfiguration, ForceEndpoint,
                           Terminate, reconnect with gap and turn-order offset
lib/aai/mouth.ts           Voice Agent client core: session.update, reply.create, updateSession,
                           end, typed events, reply latency (tools and resume land in Phase 2)
components/setup-form.tsx, calibration-banner.tsx, transcript-panel.tsx, checkpoint-board.tsx,
components/agent-bar.tsx (captions, chips, latency), components/debug-drawer.tsx (kept)
app/session/page.tsx       the room
tests/unit/*.test.ts       one per module above
tests/fixtures/golden-turns.json       the 23 finalized turns, Begin and SpeakerRevision recorded from the two-voice WAV
tests/e2e/golden.live.spec.ts          WAV through the room: six checkpoints, guaranteed_returns flag
scripts: pnpm packs:validate (vitest over packs)
removed: lib/spike/*, components/spike-controls.tsx, tests/e2e/spikes.live.spec.ts
```

## Tasks (each: failing test, implement, green, report)

Status 2026-09-06 02:00 IST: tasks 1 to 6 done, gate 7 met locally (lint, typecheck, 160 unit tests, build, smoke, live dual-session, golden E2E). Owner commit pending.

1. Pack schema and ULIP pack v1 with `pnpm packs:validate`.
2. `normalise` and `evaluateTurn` by TDD: English, Roman Hindi, Devanagari, negatives
   ("not guaranteed", "guaranteed nahi"), two-turn window including the cross-speaker
   "kab nikal sakti hoon / anytime" case, checkpoint-on-advisor-only, customer belief.
3. Transcript reducer, roles, machine, board, keyterms by TDD; the golden turns fixture runs the
   whole script through transcript + engine + board and expects all 8 checkpoints and the
   `guaranteed_returns` and `withdraw_anytime` flags.
4. `lib/aai/socket.ts`, `ears.ts`, `mouth.ts` with a fake WebSocket replaying
   `tests/fixtures/`; reconnect test with gap and offset.
5. Store, controller and the room UI; debug drawer kept; spike code removed; live dual-session
   E2E still passes (same test ids).
6. Golden E2E v1 against local and production with `SAAKSHI_FAKE_WAV`.
7. Gate: lint, typecheck, unit, build, smoke, live dual-session, golden E2E; update
   `CLAUDE.md` status and `docs/decisions.md`; report ready to commit.
