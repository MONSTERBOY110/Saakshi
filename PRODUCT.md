# Product

<!-- impeccable:product-schema 1 -->

Every fact below is confirmed from this repository's own specifications (`prd.md`, `trd.md`,
`CLAUDE.md`, `docs/decisions.md`) and from measurements taken against the live APIs, not inferred.
The owner chose the design scope in session on 2026-09-06: redesign the look, keep the behaviour.

## Platform

web

## Users

**The advisor and the customer in the room.** A relationship manager at an Indian bank branch sells
a unit-linked insurance plan to a customer who speaks Hinglish. Saakshi runs on a laptop on the desk
between them. Neither person operates it during the conversation: they talk, and it listens.

**The person running the room** is whoever pressed Start, usually the advisor. They see the screen,
they can correct a mis-assigned speaker, and they end the pitch by saying "Saakshi, verify".

**The compliance reviewer and the customer afterwards** open a verification link. They were not in
the room. They need to know whether the record is real and what was actually said.

**A hackathon judge**, for the next three weeks, is a real user: five AssemblyAI staff and about
nineteen enterprise engineers who will open the live URL, often alone, and try it without reading
anything first. Judge-solo mode exists for them.

## Product Purpose

Saakshi is an AI witness for regulated sales conversations. It knows who said what in English or
Hinglish, ticks off the disclosures the regulator requires as they are made, interrupts a
mis-selling claim out loud within two and a half seconds, runs a teach-back so the customer proves
understanding in her own words, and issues a hash-chained Consent Certificate that anyone can
verify without trusting the seller.

Success is that a customer who was mis-sold has evidence, and a firm that sold correctly has proof.

## Positioning

Call recording and post-hoc analytics tell you about a bad sale weeks later. Saakshi is in the room
while it happens: it corrects the advisor mid-sentence, and the artefact it produces is a chain of
hashes over the turns, not a summary anyone could have written afterwards. The mechanism a
neighbouring product cannot truthfully copy is the combination of live diarized listening, a spoken
intervention inside the same conversation, and a certificate whose tampering is detectable by a
stranger with a browser.

## Operating Context

- A bank branch desk. One laptop, one microphone, two people, ambient branch noise.
- The conversation is bilingual and code-switched. The same sentence can arrive from the recogniser
  in Devanagari or in Roman script, and both must work.
- Phases run in a fixed order: setup, calibrate, observe, intervene, nudge, teach-back, certify.
- The demo is three minutes. `prd.md` section 5 holds the exact script it must show.
- Verification happens later, elsewhere, on someone else's device, possibly from a printed QR code.

## Capabilities and Constraints

- AssemblyAI Streaming STT with speaker labels is the ears; the Voice Agent API is the mouth; the
  LLM Gateway does structured analysis. Two WebSockets open from the browser at once.
- **No audio is ever stored.** Quotes, timestamps and hashes only. This is not negotiable.
- **The API key never reaches the browser.** Tokens are minted server-side, single use, 60 seconds.
- Everything Saakshi says is under 25 words, with no markdown and no exclamation marks, because it
  is spoken aloud over a real conversation.
- Out of scope and settled: telephony, Hindi speech output, more than two speakers, authentication,
  CRM integration.
- Measured, live: intervention p50 1533 ms and p95 1807 ms against a 2500 ms budget; analyzer
  violation precision 1.00; question generation 5.4 s once per session.
- The LLM Gateway account currently reaches one model at two calls per minute, so every LLM path
  has a deterministic fallback and the golden-path interruption never waits on a model.

## Brand Commitments

- The name is **Saakshi**, Hindi for witness. The tagline in use is "Consent you can prove."
- Voice: plain, factual, never salesy. It is a witness, not an assistant. It states what it heard
  and what is missing.
- Colour must never be the only signal. Every verdict carries a symbol and a word as well, because
  the screen is read across a desk, on a projector, and by people who do not see colour the same way.
- MIT licensed, public repository.

## Evidence on Hand

- A working product with 369 passing unit tests and live end-to-end runs against the real APIs.
- Real measurements in `docs/decisions.md`, each with the method that produced it.
- A protocol pack, `packs/insurance-ulip-in.json`: 8 checkpoints, 6 prohibited claims with
  Devanagari, Roman Hindi and English patterns, 7 teach-back topics, the demo script.
- Pre-rendered synthetic advisor audio in `public/demo/advisor/insurance-ulip-in/`.
- Certificates that verify, and a tampered view that fails, at `/verify/<id>`.
- **No customers, no testimonials, no pricing, no benchmarks against competitors.** None of these
  exist and none may be invented on any surface.

## Product Principles

1. **Evidence over assertion.** Every claim on screen carries the quote, the speaker and the time
   that supports it. Nothing is asserted that the record cannot show.
2. **The room comes first.** Two people are talking to each other, not to the screen. The interface
   must be readable at a glance from across a desk and must never demand attention mid-sentence.
3. **Latency is a feature, so show it.** The number that proves the interruption was fast belongs
   on screen, measured honestly end to end, not as the flattering half of the measurement.
4. **A stranger must be able to check.** The certificate's proof has to survive leaving the product:
   no login, no trust in us, recomputable from the stored record alone.
5. **Never stall in front of a customer.** Every model call has a deterministic fallback, every wait
   has a timeout, and the demo continues even when a dependency is down.

## Accessibility & Inclusion

- Colour is never the sole carrier of meaning anywhere in the product.
- The transcript is bilingual; Devanagari and Roman Hindi both render and both are searchable by the
  rule engine.
- Motion respects `prefers-reduced-motion`.
- The room is used at arm's length on a shared laptop, so type and hit targets are sized for a
  glance from a metre away rather than for a phone in the hand.
