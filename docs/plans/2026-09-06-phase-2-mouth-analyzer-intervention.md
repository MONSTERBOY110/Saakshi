# Phase 2 plan: Mouth, analyzer and intervention (started Sep 6, 2026)

**Goal:** the "returns are guaranteed" interruption works end to end under 2.5 s from the end of
the advisor's turn, with a fused two-layer analyzer, a 60 s rate limit, an acknowledgement window,
and the "Saakshi, verify" nudge.

**Spec:** `prd.md` P0-5, P0-6, FR-4 to FR-6, FR-12, FR-13; `trd.md` sections 2, 5, 6.2, 12, 14;
`docs/KICKOFF-PROMPT.md` Phase 2. FR-3 as amended in `docs/decisions.md` (no `conversation.message`).
Verified today from the docs: LLM Gateway `POST /v1/chat/completions`, header `authorization: <key>`,
`response_format.json_schema` with `strict` and `additionalProperties: false`,
`post_processing_steps: [{type:"json-repair"}]`, response `choices[0].message.content` (JSON string)
plus `request_id`.

## Design

- **Layer 1 stays the trigger for critical claims.** A rule match with severity critical on an
  advisor turn intervenes at once (no LLM wait). Rule matches of high or medium severity only flag.
- **Layer 2 confirms and extends.** `/api/analyze` runs after every finalized advisor turn
  (debounced 300 ms) over the last 8 finalized turns. A violation with confidence 0.8 or more and
  severity critical or high intervenes if the rate limit allows (one per 60 s unless critical).
  Checkpoints with confidence 0.6 or more tick with the quote. Ids are restricted to the pack.
- **Interventions are scripted**: `{advisor}, a quick flag. {correction} {customer}, please note.`
  spoken through `reply.create`, at most 25 words, no markdown. Latency badge = finalized turn
  received to first `reply.audio`.
- **Acknowledgement window**: on INTERVENE the mic reaches the Mouth for up to 8 s after the
  correction finishes, with the tool `ack_intervention` exposed; a tool call or the on-screen button
  marks the violation acknowledged and returns to OBSERVE.
- **Corrections**: each prohibited item carries `corrected_patterns`; a later advisor turn matching
  one marks the open violation `corrected` (the demo's 1:20 beat).
- **Echo guard**: a finalized Ears turn whose tokens overlap 50 percent or more with something
  Saakshi just said is marked as echo and excluded from rules and calibration.
- **Nudge**: spoken "Saakshi, verify" (fuzzy) or the Verify button forces an endpoint, moves to
  NUDGE, and reads the missing disclosures in one sentence; checkpoints met afterwards are
  `met_after_nudge`. NUDGE_DONE to TEACHBACK is dispatched in Phase 3.
- **Router**: `lib/audio/router.ts` owns the gate table application and real-time pacing to the
  Mouth (frames more than 1 s ahead of wall time are dropped).

## Files

```
lib/analyzer/schema.ts       AnalysisSchema (Zod) + JSON schema for the gateway + request schema
lib/analyzer/gateway.ts      server: call the gateway with timeout and model fallback, parse, sanitize
lib/analyzer/client.ts       browser: debounced POST /api/analyze, stale-result guard
app/api/analyze/route.ts     Zod-validated, rate-limited route
lib/prompts/analyzer.ts      analyzer system prompt + pack summary builder
lib/prompts/observer.ts      OBSERVE system prompt (with the ack tool instruction)
lib/session/fusion.ts        fuse(rules, analysis, rate) -> interventions, ticks, board evaluation
lib/session/intervention.ts  composeIntervention, composeNudge, ACK_WINDOW_MS
lib/session/echo.ts          isAgentEcho
lib/session/verify-trigger.ts isVerifyTrigger
lib/audio/router.ts          createRouter (gates + pacing)
lib/aai/tools.ts             ACK_INTERVENTION_TOOL definition (type function, interactive)
lib/aai/mouth.ts             setTools, resume
lib/rules/pack.ts, engine.ts spoken labels, corrected_patterns, corrections in Evaluation
lib/session/board.ts         applyCorrections, nudge marker, met_after_nudge, latency on violations
lib/session/controller*.ts   INTERVENE and NUDGE flows, analyzer scheduling, echo guard, latency
components/*                 Verify and Acknowledge buttons, intervention banner, latency badges
tests/unit/*                 one per module; tests/fixtures/analyzer/dialogues.json (10 dialogues)
scripts/eval-analyzer.mjs    live precision/recall of the analyzer over the 10 dialogues
tests/e2e/golden.live.spec.ts  v2: intervention caption, latency badge, nudge caption
```

## Status

2026-09-06 14:00 IST: tasks 1 to 4 done. The golden E2E v2 passes live (interruption, acknowledgement, nudge); analyzer accuracy measured over the ten dialogues; intervention latency measured with a purpose-built probe WAV. Files split so each stays near the 250-line guideline: `ears-handler.ts`, `mouth-handler.ts`, `room-actions.ts`, `wiring.ts`. Blocked on the owner for LLM Gateway model access. Task 5 gate in progress.

## Tasks

1. Pure logic by TDD: analyzer schema and sanitizer, fusion and rate limit, intervention and nudge
   text, echo guard, verify trigger, router pacing, pack `spoken` and `corrected_patterns`.
2. Server analyzer: prompt, gateway call with 2.5 s timeout and `claude-haiku-4-5-20251001`
   fallback, route, mocked-fetch tests, 10 golden dialogues.
3. Mouth: tools, resume; controller flows for INTERVENE (ack window, latency), corrections,
   analyzer scheduling, echo guard, NUDGE; observer prompt swap after calibration; UI.
4. Live: golden E2E v2; ten interventions measured, p50 and p95 into `docs/decisions.md`; live
   analyzer precision over the 10 dialogues.
5. Gate: lint, typecheck, unit, build, smoke, live dual-session, golden v2; status docs.
