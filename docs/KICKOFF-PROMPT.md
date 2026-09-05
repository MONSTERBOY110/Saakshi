# Kickoff prompt for the Saakshi engineering agent

Paste everything below the line into Claude Code inside `D:\Projects\Saakshi` to start. Re-paste the relevant phase block at the start of each new session.

---

You are the engineering agent for Saakshi, our entry to the lablab.ai x AssemblyAI Voice Agent Hackathon. Hard deadline Sep 30 2026 8:30 PM IST; we submit Sep 29. Read, in order and completely: `CLAUDE.md`, `prd.md`, `trd.md`, `docs/assemblyai-voice-agent-gotchas.md`. Then confirm in three sentences what we are building, who the judges are, and what the golden-path demo shows. Do not write code before that confirmation.

Operating rules for every phase:
- Use `superpowers:brainstorming` only for features not already specified in prd.md/trd.md. Everything specified is approved; build it.
- Use `superpowers:test-driven-development` for pure logic and `superpowers:systematic-debugging` for any audio or WebSocket issue.
- Fetch AssemblyAI docs (MCP `assemblyai-docs` or WebFetch) for any payload you are not certain about. Never guess.
- Commit with Conventional Commits at least hourly, push daily, keep `main` deployable, one Vercel preview per PR.
- At the end of each phase: run `pnpm test`, `pnpm lint`, `pnpm build`, the golden E2E, update the **Current status** section of `CLAUDE.md` and `docs/decisions.md`, and stop for review. Do not start the next phase until the gate is met.
- Report faithfully. If a spike fails, say so and apply the documented fallback.

## Phase 0 — Bootstrap and spikes (Sep 5–6)

Goal: both AssemblyAI sessions running from the browser on a Vercel preview, and the ten day-one unknowns answered.

1. Install tooling: `claude mcp add --transport http --scope user assemblyai-docs https://mcp.assemblyai.com/docs` and `npx skills add AssemblyAI/assemblyai-skill --global`. Confirm the hackathon credits are active at https://www.assemblyai.com/dashboard/activation and create the API key.
2. Scaffold: Next.js 15 (App Router, TypeScript strict), pnpm, Tailwind, shadcn/ui, Zod, Vitest, Playwright, ESLint, Prettier, GitHub Actions (lint + unit + build on push). Create the folder layout from `trd.md` section 10 with placeholder modules. Add `README.md` with a one-paragraph description and the architecture diagram (mermaid from trd.md).
3. Route handlers `/api/token/stt` and `/api/token/agent` per trd.md section 9, with rate limiting and Zod-validated responses. Unit test with mocked fetch.
4. Minimal `/session` page: Start button → mic capture (exact `getUserMedia` constraints from the gotchas file) → AudioWorklet 24 kHz PCM16 → (a) binary frames to Streaming STT with `speaker_labels=true`, `max_speakers=2`, `language_codes=[en,hi]`, `language_detection=true`, `voice_focus=far-field`; (b) base64 frames to a Voice Agent session opened with the inline `session.update` from trd.md section 5 and a one-line greeting. Render raw `Turn` events and agent captions in a debug drawer. Implement playback and flush from the gotchas file.
5. Record real payload fixtures into `tests/fixtures/` (`Begin`, partial and final `Turn` with two speakers, `SpeakerRevision`, `session.ready`, `reply.audio`, `transcript.agent`, `reply.done interrupted`).
6. Run spikes S1–S10 from `trd.md` section 17. Write each result and the chosen fallback into `docs/decisions.md`.
7. Deploy to Vercel (connect the GitHub repo, set env vars). Confirm the preview URL opens the mic and both sessions from a fresh Chromium profile.

Gate: preview URL live; both sessions produce events; fixtures committed; S1–S10 answered.

## Phase 1 — Ears and the Checkpoint Board (Sep 7–11)

Goal: a live diarized two-speaker transcript with roles, and a rule engine that ticks checkpoints and flags violations on the rehearsed script.

1. `lib/aai/ears.ts`: typed client for the Streaming STT WebSocket (connect with token, params builder, handlers for every message type in trd.md section 4, `UpdateConfiguration`, `ForceEndpoint`, `Terminate`, reconnect with gap logging). Test with fixtures.
2. Role calibration (P0-2): greeting asks advisor then customer to say their name; bind speaker labels; "Swap roles" control; handle `PENDING` and `SpeakerRevision`.
3. Transcript UI (P0-3): role colours, live partials, locked finals, language tag per turn, timestamps.
4. `packs/insurance-ulip-in.json` v1 with the checkpoints, prohibited claims, citations, corrections, teach-back topics and demo script from trd.md section 6.1 and prd.md section 5. Validate with a Zod schema; add a `pnpm packs:validate` script.
5. `lib/rules/engine.ts` and `normalise.ts` by TDD: table-driven tests for English, Roman Hindi and Devanagari forms, negatives, and the two-turn sliding window. Checkpoints tick only on advisor turns.
6. Checkpoint Board UI (P0-4): grey → green with quote and time; red flags with severity and citation; a small latency badge slot.
7. Push names and product terms into STT `keyterms_prompt` and `prompt` at session start; update mid-session when the product name changes.
8. Golden E2E v1: Playwright with a two-voice WAV of the script asserting at least six checkpoints tick and `guaranteed_returns` flags.

Gate: rehearsed script produces a correct role-labelled transcript and board; unit tests and E2E v1 green; light day on Sep 8 for HackSpire.

## Phase 2 — Mouth, analyzer and intervention (Sep 12–16)

Goal: the "guaranteed returns" interruption works end-to-end under 2.5 seconds, with a fused two-layer analyzer.

1. `lib/aai/mouth.ts`: typed Voice Agent client (token, inline `session.update`, all events in trd.md section 5, `conversation.message`, `reply.create`, `session.update` for prompt and tools, `tool.call`/`tool.result`, `session.resume`, `session.end`). Test with fixtures.
2. `lib/session/machine.ts`: reducer with phases SETUP, CALIBRATE, OBSERVE, INTERVENE, NUDGE, TEACHBACK, CERTIFY, DONE and the audio-gate table from trd.md section 2. Test every transition.
3. Audio router (`lib/audio/router.ts`): Ears always; Mouth only when gated; real-time pacing. Unit tests.
4. OBSERVE: inject each finalized turn as `conversation.message` with role and mm:ss; verify against the S4 spike result.
5. `/api/analyze` with the strict JSON schema from trd.md section 6.2 on `gemini-3.5-flash-lite`, `json-repair` post-processing, 2.5 s timeout, fallback `claude-haiku-4-5-20251001`. Mock in CI; golden outputs for 10 dialogues.
6. Fusion and rate limit (FR-5). Intervention via `reply.create` with the pack's correction text (FR-6), 8 s ack window with `ack_intervention` tool, latency badge from finalized `Turn` to first `reply.audio`.
7. NUDGE on "Saakshi, verify" (spoken trigger detected in the Ears transcript) or button: read missing checkpoints in one sentence (P0-6).
8. Measure ten interventions; record p50 and p95 in `docs/decisions.md`. If p50 > 2.5 s, move the critical patterns fully onto the deterministic path.

Gate: interruption demo works live and on the E2E; p50 ≤ 2.5 s; analyzer precision on the 10 golden dialogues ≥ 0.9.

## Phase 3 — Teach-back and Consent Certificate (Sep 17–21)

Goal: the full golden path ends in a VALID certificate; a tampered copy shows TAMPERED.

1. `/api/teachback/questions` (trd.md 6.3) generating 3–5 adaptive questions from checkpoint state and violations; strict schema; `claude-sonnet-4-6`.
2. TEACHBACK phase: prompt swap, mic gate open, tools `record_answer` and `reexplain`, progressive reveal of `finish_teachback` (hold mode) after three answers, question-aware turn-detection thresholds, advisor-speaks guard via Ears diarization (FR-7, FR-8).
3. Teach-back UI: question, live customer transcript, verdict chips, re-explain marker.
4. `lib/cert/chain.ts` and `canonical.ts` by TDD (FR-9): known-answer tests, tamper test. Build the certificate object (trd.md section 7) including the minimal turns digest list.
5. `/api/certificate` (store in Upstash, recompute hash, reject mismatch), `/api/certificate/[id]`, `/verify/[id]` page (recompute chain and hash, VALID or TAMPERED, evidence table, QR). Print stylesheet for the certificate page.
6. Session resume: on socket drop during TEACHBACK, reconnect within 30 s with `session.resume`; log a gap into the certificate.
7. Golden E2E v2: full path to a stored certificate whose verify page reads VALID.

Gate: golden path end-to-end live and in E2E; tamper demo works; light day on Sep 20 for SIH.

## Phase 4 — Judge-solo mode, second pack, evals, polish (Sep 22–25)

Goal: a stranger completes the demo alone in three minutes; the product reads as a platform; metrics are on screen.

1. `scripts/render-advisor.mjs`: pre-render Rahul's lines from `pack.demo_script` with voice `george` via a throwaway Voice Agent session; save PCM to `public/demo/advisor/`.
2. Judge-solo mode (P0-10): mixer feeds synthetic PCM into Ears and speakers, never into Mouth; auto-advance per `wait_for`; "Script hints" drawer with suggested customer lines including Hinglish ones; on by default via env.
3. `packs/loan-kfs-in.json` (P1-1) and a pack switcher on the start screen.
4. Eval harness (P1-2): `scripts/gen-corpus.ts` produces 60+ labelled advisor turns via the LLM Gateway; `eval/run.ts` computes precision and recall for rules, LLM and fused; `/metrics` page and README table.
5. Hindi captions of agent speech (P1-4) and PII toggle (P1-5) if time allows.
6. Design pass with `frontend-design`/`impeccable`: landing page, session room, certificate, verify page. Distinctive, calm, evidence-forward. Colour never the only signal.
7. Run the deployed URL as a judge would (Playwright MCP, fresh profile, no hints). Fix every stumble.
8. Optional: Bluejay bridge and three simulated personas; screenshots in README.

Gate: three volunteers (or you, cold) complete judge-solo in ≤ 3 minutes; metrics visible; loan pack demoable in 20 seconds.

## Phase 5 — Submission assets (Sep 26–28)

1. Record the golden path three times in judge-solo and two-person modes; pick the best; edit to 4–5 minutes following prd.md section 11 (problem 0:30, demo to 3:00, business to 4:00, tech and roadmap to 4:45). Captions on.
2. Slides with `ppt-master`, 8–10 pages: problem (FCA and IRDAI quotes), insight, demo stills, architecture, AssemblyAI features used by name, evidence and certificate, business model and market, roadmap, team. Export PDF.
3. README final: hero GIF, architecture diagram, features, AssemblyAI usage table, metrics, setup, demo instructions, licence.
4. 16:9 cover PNG. `docs/submission.md` with title, short description, long description, tags, links.
5. Freeze `main`. Tag `v1.0.0`.

Gate: every item on the CLAUDE.md submission checklist is ticked except "Submitted".

## Phase 6 — Submit (Sep 29)

Submit on the lablab team page, verify every link in a fresh browser, save the confirmation screenshot into `docs/`. Sep 30 is buffer only.

---

Start now with Phase 0, step 1. After reading the four documents, reply with the three-sentence confirmation and the list of Phase 0 tasks as a todo list, then begin.
