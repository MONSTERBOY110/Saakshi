# CLAUDE.md — Saakshi operating manual

You are the engineering agent for **Saakshi**, a hackathon entry that must place in the top 5 of the lablab.ai x AssemblyAI Voice Agent Hackathon. Read this file first, then `prd.md`, then `trd.md`, then `docs/assemblyai-voice-agent-gotchas.md`, then `docs/KICKOFF-PROMPT.md`. Do not start coding before you have read all four.

## The mission in one breath

Saakshi is an AI witness that sits in on regulated sales conversations, knows who said what in English or Hinglish, interrupts mis-selling within two seconds, runs a teach-back with the customer, and issues a hash-chained Consent Certificate anyone can verify. It uses AssemblyAI's Streaming STT (diarized) as its ears, the Voice Agent API as its mouth, and the LLM Gateway for structured analysis.

## Dates that matter

| What | When (IST) |
|---|---|
| Current phase | see the **Current status** section at the bottom and `docs/decisions.md` |
| Internal submission target | **Sep 29 2026** |
| Hard deadline | **Sep 30 2026, 8:30 PM IST** |
| Builder's other commitments | HackSpire deck due Sep 8; SIH idea deadline Sep 20. Plan light days around them. |

## Judging and what it means for you

Four equal criteria: **Application of Technology, Presentation, Business Value, Originality**. Judges: five AssemblyAI staff (they notice deep, correct use of their API) and about nineteen enterprise engineers from Amex, Prudential, Meta, Amazon Ads, Zocdoc and fintech security (they notice business value, evidence and polish). Judges check the GitHub commit history for steady work; commit small and often with clear messages.

## Non-negotiables

1. **Public MIT repo, live Vercel URL, MP4 video, PDF slides, 16:9 cover.** No submission without all five.
2. **P0 before P1, always.** The P0 list in `prd.md` section 4.1 is the product. If a P1 item is not done by Sep 22, drop it without discussion.
3. **The golden path is sacred.** Every feature must be visible in the 3-minute demo script in `prd.md` section 5. If it is not, ask whether it belongs.
4. **Docs are the source of truth.** For any AssemblyAI payload, field, voice id, or error code, fetch the docs (MCP server `assemblyai-docs` or WebFetch). Never guess an API shape from memory.
5. **Never expose the API key to the browser.** Tokens are minted server-side, single use, ≤ 60 s.
6. **No audio is ever stored.** Quotes, timestamps and hashes only.
7. **No telephony, no Hindi TTS, no >2 speakers, no auth, no CRM.** These are decided out of scope. Do not reopen.
8. **Verify before you claim.** Run the tests, open the page, watch the WebSocket log. "It should work" is not a status.

## Setup for a fresh session

```bash
# AssemblyAI docs as an MCP server and their Claude Code skill
claude mcp add --transport http --scope user assemblyai-docs https://mcp.assemblyai.com/docs
npx skills add AssemblyAI/assemblyai-skill --global

# project
pnpm install
cp .env.example .env.local      # fill ASSEMBLYAI_API_KEY (claim hackathon credits via the lablab page link first,
                                # then confirm at https://www.assemblyai.com/dashboard/activation)
pnpm dev                        # http://localhost:3000 (localhost is a secure context; mic works)
pnpm test                       # vitest unit tests
pnpm test:e2e                   # playwright with fake mic WAV
pnpm lint && pnpm build
```

Until the scaffold exists, the first task is to create it exactly as `trd.md` section 10 lays out (Next.js 15, TypeScript strict, Tailwind, shadcn/ui, Zod, Vitest, Playwright, pnpm).

## Architecture in ten lines

1. Browser captures mic (AEC on, noise suppression off, AGC on) into an AudioWorklet at 24 kHz PCM16.
2. An audio router sends every 50 ms frame to the **Ears** (Streaming STT WS, `universal-3-5-pro`, `speaker_labels`, `max_speakers=2`, `language_codes=[en,hi]`, `voice_focus=far-field`, keyterms, prompt).
3. The same frame goes to the **Mouth** (Voice Agent WS) **only** in INTERVENE-ack and TEACHBACK phases. Otherwise the Mouth receives finalized turns as `conversation.message` text tagged with role and time.
4. A client-side state machine owns the phase: SETUP → CALIBRATE → OBSERVE → (INTERVENE) → NUDGE → TEACHBACK → CERTIFY → DONE.
5. Every finalized Ears turn runs through the deterministic rule engine (protocol pack JSON) and, for advisor turns, through the LLM analyzer (LLM Gateway, strict JSON schema).
6. A confirmed critical violation triggers `reply.create` with the exact correction text; the agent speaks it in under 20 words.
7. TEACHBACK swaps the system prompt, streams the mic, and exposes tools `record_answer`, `reexplain`, then `finish_teachback` (hold mode) after three answers.
8. Finalized turns are hash-chained client-side; the certificate hash is recomputed server-side on store and on `/verify/[id]`.
9. Judge-solo mode mixes pre-rendered synthetic advisor PCM into the Ears stream and the speakers, never into the Mouth.
10. Vercel route handlers only mint tokens, call the LLM Gateway, and store certificates in Upstash Redis.

## Engineering rules

- **TypeScript strict, Zod at every boundary, small files.** A file over ~250 lines is a smell.
- **TDD for pure logic:** rule engine, hash chain, canonical JSON, state machine, audio mixer. Write the failing test first.
- **Fixture-driven for WebSockets:** record real `Turn`, `SpeakerRevision`, `tool.call`, `reply.done` payloads into `tests/fixtures/` on day one and replay them.
- **One golden E2E:** Playwright Chromium with `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=tests/fixtures/golden.wav` must pass before any merge to `main`.
- **Commit style:** Conventional Commits (`feat(ears): apply SpeakerRevision to stored turns`). Commit at least every hour of work. Push daily. Judges read the history.
- **Branching:** short-lived feature branches, PR to `main`, Vercel preview per PR. `main` is always deployable.
- **Decisions go in `docs/decisions.md`** with date, decision, why. Spike results (trd.md section 17) go there first.
- **Prompts are code.** They live in `lib/prompts/*.ts`, are versioned, and every change is smoke-tested by ear against the golden script.
- **No markdown, no exclamation marks, under 25 words** in anything the agent speaks.
- **Latency is a feature.** Log and display end-of-turn → first agent audio for every intervention.

## Voice-specific rules (from AssemblyAI, condensed; full text in docs/assemblyai-voice-agent-gotchas.md)

- PCM16 mono 24 kHz base64 for the Voice Agent; raw binary PCM for Streaming STT. Chromium: `new AudioContext({ sampleRate: 24000 })`.
- Never send `input.audio` before `session.ready`. Never send faster than real time.
- `greeting` and `output.voice` are immutable after ready; `system_prompt`, `tools`, `input.keyterms`, `input.turn_detection` are mutable.
- `tool.result.result` is a JSON **string**; echo `call_id`; send immediately.
- Flush playback on `input.speech.started` and on `reply.done` with `status: "interrupted"`.
- Send `session.end` before closing on purpose, or you pay for a 30 s resume window.
- Turn detection defaults that feel human: `vad_threshold 0.5, min_silence 1400, max_silence 4000`; after the agent asks a question, `2200 / 6000`, revert on the next user transcript.
- Do not use tools for logging, extraction or summarisation; use the transcript events and one LLM Gateway call.
- Pair every lookup or name with `keyterms`.

## Skills and tools you should use

- `superpowers:brainstorming` before any new feature that is not already specified in prd.md/trd.md.
- `superpowers:test-driven-development` for all pure logic.
- `superpowers:systematic-debugging` for any audio, WebSocket or diarization bug. Audio bugs are almost always sample rate, echo cancellation, or the interrupt flush.
- `superpowers:verification-before-completion` before reporting any task done.
- `frontend-design` / `impeccable` for the design pass in Phase 4 only. Do not polish pixels before the golden path works.
- `ppt-master` for the slide deck in Phase 5.
- Playwright MCP to test the deployed Vercel URL like a judge would.

## The demo script you are building toward

Rahul (advisor) sells a ULIP to Mrs. Sharma (customer, Hinglish). Saakshi calibrates roles by name, ticks checkpoints as Rahul speaks, interrupts "returns are guaranteed, twelve percent" with a 20-word correction, nudges the missing free-look disclosure on "Saakshi, verify", asks Mrs. Sharma four teach-back questions she answers in Hinglish, re-explains charges once, and issues a certificate whose verify page shows VALID and, after a one-character edit, TAMPERED. Three minutes. Full table in `prd.md` section 5.

## Submission checklist (owner: you, by Sep 29)

- [ ] Live URL on Vercel, judge-solo mode on by default, works in a fresh Chromium profile
- [ ] Public GitHub repo, MIT LICENSE, README with architecture diagram, setup, demo instructions, metrics
- [ ] MP4 video 4–5 min following the structure in `prd.md` section 11
- [ ] PDF slides 8–10 pages
- [ ] 16:9 PNG cover
- [ ] Title, short description, long description, tags prepared in `docs/submission.md`
- [ ] Certificate verify link and a tampered example ready to show
- [ ] Cost per session and eval metrics visible in-app
- [ ] Submitted on lablab, confirmation screenshot saved

## Things you must not do

- Reopen scope decisions listed under Non-negotiables.
- Add auth, billing, databases beyond the certificate store, or any integration.
- Store, upload or replay audio.
- Guess AssemblyAI payloads. Fetch the docs.
- Spend a day on UI before Phase 4.
- Report "done" without running the tests and the golden E2E.

## Current status

Maintain this section at the end of every working session: phase, what shipped, what is blocked, next three tasks.

- **Phase:** 0 (bootstrap and spikes). Nothing shipped yet.
- **Shipped:** repo docs only (prd.md, trd.md, CLAUDE.md, docs/).
- **Blocked:** nothing.
- **Next three tasks:** (1) install AssemblyAI MCP + skill and claim credits, (2) scaffold Next.js per trd.md section 10, (3) token routes and the dual-session `/session` spike page. Details in `docs/KICKOFF-PROMPT.md`, Phase 0.
