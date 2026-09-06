# Phase 3 plan: teach-back and the Consent Certificate (Sep 6 to 21, 2026)

**Goal:** the full golden path ends in a stored Consent Certificate whose public verify page reads
VALID, and a one-character edit of the stored payload makes it read TAMPERED.

**Spec:** `prd.md` P0-7 to P0-9, FR-7 to FR-10; `trd.md` sections 2, 5 (teach-back), 6.3, 7, 9;
`docs/KICKOFF-PROMPT.md` Phase 3. Amendments already recorded in `docs/decisions.md`: no
`conversation.message` (S4), the account's LLM Gateway reaches one model at two calls a minute, and
`tool.result` timing has two conflicting official sources and must be measured.

## Design

- **Questions.** `/api/teachback/questions` asks the gateway once per session for three to five
  questions built from what was actually said: topics that were flagged, then topics only barely
  covered, then the rest. One call per session fits the two-per-minute cap. The route falls back to
  pack-derived questions when the gateway is unavailable, so the demo never stalls.
- **Question quality is checked, not assumed.** Questions must be under eighteen spoken words,
  free of markdown, and must not contain a number that nobody said. A rejected question is replaced
  by its pack fallback.
- **Teach-back phase.** `session.update` swaps to the teach-back prompt and exposes `record_answer`
  and `reexplain`; `finish_teachback` (hold mode) appears only after three answers, with one line
  appended to the prompt. The mic reaches the Mouth throughout, still gated while Saakshi speaks.
  After a question, turn detection relaxes to 2200/6000 ms and reverts on the next customer speech.
- **The advisor-speaks guard** uses the Ears diarization, not the agent's own transcript: when a
  finalized turn during TEACHBACK belongs to the advisor, Saakshi asks the customer to answer in her
  own words (through `reply.create`, since `conversation.message` is not read).
- **Tool result timing.** Send `tool.result` immediately, and measure whether replies stay coherent;
  record the answer in `docs/decisions.md` so the conflict in the docs is settled with evidence.
- **Hash chain.** Exactly FR-9, in `lib/cert/chain.ts` over finalized non-echo turns in order,
  with Web Crypto in the browser and Node crypto on the server. Canonical JSON is keys sorted, no
  whitespace, UTF-8. The server recomputes on store and rejects a mismatch; the verify page
  recomputes both the chain head and the certificate hash from the stored payload alone.
- **Storage.** Upstash Redis when `KV_REST_API_URL` is set, otherwise an in-memory map plus a
  Download JSON button, so the flow works on a laptop with no store provisioned.
- **Resume.** A Mouth drop during TEACHBACK reconnects with `session.resume` inside 30 s and writes
  a gap into the certificate; the Ears client already records its own gaps.

## Files

```
lib/cert/canonical.ts     canonicalJson, sha256Hex (Web Crypto and Node)
lib/cert/chain.ts         chainHead, turnDigest, certificateHash, verifyCertificate
lib/cert/build.ts         buildCertificate(room state) -> CertificateDraft
lib/cert/schema.ts        Zod for Certificate and CertificateDraft (shared client and server)
lib/cert/store.ts         Upstash REST client with an in-memory fallback
lib/teachback/questions.ts  fallback questions from the pack, validation, ordering
lib/prompts/teachback.ts    system prompt and the question-generator prompt
lib/aai/tools.ts            record_answer, reexplain, finish_teachback definitions
lib/session/teachback.ts    phase flow: prompt swap, tools, verdicts, re-explain, finish
lib/session/store.ts        teachback state, certificate id and hash
app/api/teachback/questions/route.ts
app/api/certificate/route.ts, app/api/certificate/[id]/route.ts
app/verify/[id]/page.tsx    server component: recompute, VALID or TAMPERED, evidence table, QR
components/teachback-panel.tsx, components/certificate-card.tsx
tests/unit/{canonical,chain,cert-build,cert-store,questions,teachback}.test.ts
tests/e2e/golden.live.spec.ts  v3: through teach-back to a stored certificate that verifies
```

## Tasks

1. Canonical JSON and the hash chain by TDD: known-answer tests, a tamper test that flips one
   character, and equality between the browser and Node implementations.
2. Certificate schema and builder from room state, including turns digest, gaps and `demo: true`.
3. Store, `/api/certificate` (recompute and reject a mismatch), `/api/certificate/[id]`, and
   `/verify/[id]` with the evidence table, QR and print stylesheet.
4. Question generation: prompt, route with fallback, validation, unit tests with a mocked gateway,
   then one live check of question quality on the reachable model.
5. TEACHBACK flow and UI: prompt swap, tools, verdict chips, re-explain marker, advisor guard,
   adaptive turn detection, progressive `finish_teachback`.
6. Resume on a Mouth drop during teach-back, with the gap recorded in the certificate.
7. Golden E2E v3 to a stored certificate reading VALID, plus a tamper check.
8. Gate: lint, typecheck, unit, build, smoke, live dual-session, golden v3; status docs.

## Status on 2026-09-06 (evening IST)

All eight tasks are done and the gate passes locally. Nothing is committed: the owner gates that.

| Task | State | Evidence |
|---|---|---|
| 1 Canonical JSON and hash chain | done | `tests/unit/{canonical,chain}.test.ts`, 22 tests. Hashing is Web Crypto in both runtimes; the `node:crypto` fallback was removed because it broke the client bundle. |
| 2 Certificate schema and builder | done | `tests/unit/cert-build.test.ts`, 10 tests. |
| 3 Store, routes and the verify page | done | `tests/unit/{cert-store,cert-routes}.test.ts`, `tests/e2e/verify.spec.ts` (VALID, TAMPERED, NOT FOUND). |
| 4 Question generation | done | `tests/unit/questions.test.ts` (26 with the route), one live check: `pnpm eval:questions`, five of five questions kept on `qwen3.5-4b-32k-fast`. |
| 5 TEACHBACK flow and UI | done | `tests/unit/{teachback,tool-results}.test.ts`, 23 tests; the panel and the certificate card render in the room. |
| 6 Resume on a Mouth drop | done | `tests/unit/mouth-resume.test.ts`, 8 tests; the silence is written into the certificate as a gap. |
| 7 Golden E2E v3 | done | `pnpm test:e2e:golden`: intervention 1703 ms, certificate `saomjyXyRcLZOROE`, verify page VALID and the tampered copy TAMPERED. |
| 8 Gate | done | lint, typecheck, 330 unit tests, build, smoke (5), live dual-session (1363 frames, none unparseable), golden v3. |

Three things came out of the phase that were not in the plan, all recorded in `docs/decisions.md`: the `tool.result` timing conflict is settled in favour of the docs and the gotchas file is corrected; role calibration now recognises a name written in Devanagari, after a golden run bound the roles backwards; and issuing the certificate now closes the session's sockets, which it previously left open.

The one thing the phase does not prove live is teach-back answer recording. The golden WAV is a fixed recording that Chromium loops, and the questions are generated per session, so pre-rendered answers cannot line up with them. The tools and guards are unit tested; the live path needs the owner speaking answers or judge-solo mode in Phase 4.
