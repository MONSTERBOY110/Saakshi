# Saakshi — Product Requirements Document

**Tagline:** Consent you can prove.
**One-liner:** Saakshi is an AI witness that sits in on regulated sales conversations, knows who said what, speaks up the moment a customer is about to be misled, and ends by producing a verifiable Consent Certificate proving the customer understood what they agreed to.

| Field | Value |
|---|---|
| Version | 1.0 (locked for build) |
| Date | 2026-09-05 |
| Owner | Team MONSTER (solo builder) |
| Event | lablab.ai x AssemblyAI Voice Agent Hackathon, Sep 1–30 2026 |
| Hard deadline | **Sep 30 2026, 8:30 PM IST**. Internal target: submit **Sep 29**. |
| Companion docs | `trd.md` (technical design), `CLAUDE.md` (agent operating manual), `docs/KICKOFF-PROMPT.md` (phase plan) |

"Saakshi" (साक्षी) is Sanskrit and Hindi for *witness*.

---

## 1. Why this exists

### 1.1 The problem

Financial products are sold in conversations. The paperwork that follows proves a signature, not understanding. Compliance today is post-hoc: calls are recorded, a QA team samples a few percent, and disputes are argued months later from a transcript nobody read at the time.

Regulators have started saying this out loud:

- **UK FCA, March 2026** consumer-understanding review under the Consumer Duty (PRIN 2A.5): "sales data and the absence of complaints do not prove customers understood anything." Firms are told to move from dashboards to evidence of understanding, including across distribution chains.
- **India IRDAI, FY25 annual report:** mis-selling grievances against life insurers rose 14.3% to **26,667**, now 22.14% of all life-insurance grievances. Savings- and investment-linked products (ULIPs, endowments) are the most complaint-prone. IRDAI's 2024 Protection of Policyholders regulations made the **30-day free-look period** universal and made a **customised benefit illustration at point of sale** mandatory.
- **India RBI:** the **Key Facts Statement (KFS)** is mandatory for every retail and MSME loan sanctioned since **Oct 1 2024** (APR, all charges, fixed vs floating). Anything not in the KFS cannot be charged. RBI has said it will issue mis-selling guidelines for financial products in FY26.

The scale is large: India's life insurers collected **₹3.97 lakh crore** of new business premium in FY25 through **30+ lakh** individual agents, with bancassurance the dominant private channel. Most of those sales happen in Hindi-English code-switched speech ("Hinglish") that no compliance tool handles well.

### 1.2 The insight

A voice agent does not have to be the thing the customer talks *to*. It can be the third participant in the room. Three AssemblyAI capabilities make this possible for the first time:

1. **Live speaker diarization** on Universal-3.5 Pro streaming, so the agent knows which words came from the advisor and which from the customer.
2. **Native Hindi-English code-switching**, so the customer can answer the way they actually speak.
3. **The Voice Agent API**, so the agent can interrupt at the right moment, run a structured teach-back, and call tools, with about one second of latency.

The output is not a transcript. It is evidence: who said what, when, whether the required things were said, whether the prohibited things were said, and whether the customer could explain the product back in their own words.

### 1.3 Why we will win (judge mapping)

| Judging criterion | How Saakshi scores |
|---|---|
| Application of Technology | Uses **both** AssemblyAI paths simultaneously: diarized Streaming STT as the ears, Voice Agent API as the mouth, LLM Gateway for structured analysis. Exercises keyterms, prompt context, code-switching, semantic turn detection, tool calling with `hold` and `interactive` modes, mid-session `system_prompt` swaps, `conversation.message` context injection, session resume. |
| Presentation | A 3-minute demo with one unforgettable moment: the agent interrupting "guaranteed returns". Judge-solo mode so any judge can try it alone. Live metrics on screen. |
| Business Value | Regulatory pull on two continents, a clear buyer (compliance and distribution heads), per-conversation pricing, quantified complaint volumes. |
| Originality | No other entry is multi-party, none produce proof of understanding, none use Hinglish. The teach-back plus hash-chained Consent Certificate is a new mechanism, not a wrapper. |

---

## 2. Users and buyers

| Role | Who | What they need from Saakshi |
|---|---|---|
| Buyer | Head of Compliance, Chief Distribution Officer at life insurers, banks (bancassurance), NBFCs; UK firms under Consumer Duty | Fewer mis-selling complaints and free-look cancellations, regulator-ready evidence, no change to the sales conversation itself |
| Primary user | Advisor / relationship manager / bank branch staff | A quiet co-pilot that only speaks when it must, a checklist that fills itself, protection from later "he-said-she-said" |
| Protected party | Customer, often first-time buyer, often more comfortable in Hindi or Hinglish | To be told the truth in the moment, to be asked whether they understood, in their own words |
| Reviewer | Compliance QA, ombudsman, auditor | A certificate whose every claim links to speaker, timestamp and quote, and whose integrity can be re-verified |
| Judge (hackathon) | Solo evaluator with a laptop mic | Must be able to run the full three-party flow alone in under 3 minutes |

---

## 3. Product principles

1. **Silent until it matters.** Interventions are rare, under 20 words, and cite the rule. Never lecture.
2. **Speaker-attributed or it did not happen.** Every checkpoint, violation and teach-back verdict links to a speaker label, a turn, word-level timestamps and the quoted words.
3. **Understands Hinglish, speaks plain English.** Hindi TTS is not yet available in the Voice Agent API. The agent understands Hindi and Hinglish input natively and replies in calm Indian-audience English. On-screen Hindi captions are a stretch goal.
4. **The protocol pack decides, the model extracts.** Required disclosures and prohibited claims live in a versioned, human-readable pack with citations. The LLM finds evidence; it does not invent rules. Anti-fabrication is enforced in every prompt.
5. **Evidence over recording.** No raw audio is stored by default. The certificate contains quotes, timestamps and hashes, not the call.
6. **Demo-first engineering.** Every feature must be visible in the 3-minute golden path or it is not P0.

---

## 4. Scope

### 4.1 P0 — must ship (by Sep 29)

| ID | Feature | Acceptance criteria |
|---|---|---|
| P0-1 | **Session setup** | User picks a protocol pack (default: `insurance-ulip-in`), enters advisor name, customer name, product name and optional product terms. Names and terms become STT keyterms and Voice Agent keyterms automatically. |
| P0-2 | **Role calibration** | Saakshi greets in one sentence and asks the advisor, then the customer, to say their name. The first finalized diarized turn after each prompt binds that speaker label to that role. A visible "Swap roles" control fixes mistakes in one click. |
| P0-3 | **Live diarized transcript** | Two-speaker live transcript with role colours, partials rendered live, finals locked, language tag per turn (en / hi / mixed). Speaker revisions at session end are applied. |
| P0-4 | **Checkpoint Board** | The pack's required disclosures (for ULIP: premium and payment term, policy term, 5-year lock-in, charges, market-linked risk, benefit illustration at 4% and 8%, surrender value, 30-day free look) tick green when detected in an *advisor* turn, with the quote and timestamp attached. Prohibited claims (guaranteed or assured returns, "like an FD", "no charges", "tax-free forever", "sign today or lose it") flag red with severity and rule citation. |
| P0-5 | **Intervention** | When a critical prohibited claim is confirmed, Saakshi speaks a correction of at most 20 words within 2.5 s of the advisor's end of turn, addressed to both parties, citing the rule in plain words. Rate limit: at most one intervention per 60 s unless severity is critical. The advisor can acknowledge by voice or button. The event is recorded with the quote that triggered it. |
| P0-6 | **Missing-disclosure nudge** | When the advisor signals the end of the pitch (button or spoken "Saakshi, verify"), any unticked required checkpoint is read out once as a single sentence before teach-back begins. |
| P0-7 | **Teach-back** | Saakshi asks the customer 3 to 5 questions generated from what was actually said (not a fixed script), one at a time, waits patiently (longer silence thresholds after a question), understands answers in English, Hindi or Hinglish, and records each as understood / partial / not understood with the customer's quote. On partial or not understood it re-explains once in one or two sentences and re-asks. If the advisor answers instead of the customer, Saakshi politely asks the customer to answer in their own words. |
| P0-8 | **Consent Certificate** | On completion Saakshi generates a certificate containing: parties, product, pack id and version, session times, checkpoint results with quotes and timestamps, violations with resolutions, teach-back Q/A with verdicts, a SHA-256 hash chain over all finalized turns, and a certificate hash. Rendered as a printable page with a QR code. |
| P0-9 | **Public verification** | `/verify/[id]` fetches the stored certificate, recomputes the hash chain and certificate hash, and shows VALID or TAMPERED with the evidence table. |
| P0-10 | **Judge-solo mode** | A synthetic advisor (pre-rendered voice lines from the pack's demo script) plays the advisor's side. Its audio is mixed into the STT stream so diarization labels it as a distinct speaker, and it is played through the speakers so the judge hears it. The judge plays the customer. The script advances automatically after each line or on click. A collapsible on-screen "what to say" hint helps the judge. |
| P0-11 | **Deployment and repo** | Live on Vercel at a public URL, public GitHub repo under MIT, README with architecture diagram, setup, and demo instructions. Consistent commits throughout the event. |

### 4.2 P1 — should ship if P0 is green by Sep 22

| ID | Feature |
|---|---|
| P1-1 | Second protocol pack: `loan-kfs-in` (RBI KFS: APR, tenure, EMI, all fees, fixed vs floating, prepayment and foreclosure charges, "nothing outside the KFS can be charged"). Shown for 20 seconds in the video to prove the platform story. |
| P1-2 | Eval harness: synthetic labeled corpus of 60+ advisor turns; precision and recall for violation and checkpoint detection (rules only, LLM only, combined); latency log from live sessions; results on a `/metrics` page and in README. |
| P1-3 | Session resume demo: kill the network for 10 s mid teach-back, resume with `session.resume`, certificate notes the gap. |
| P1-4 | Hindi caption of what Saakshi says (LLM translation) displayed under the English speech. |
| P1-5 | PII redaction toggle for the transcript display (STT `redact_pii` with a policy subset that keeps names). |
| P1-6 | Bluejay simulated-caller run with three personas; screenshots in README. |
| P1-7 | Export certificate as PDF (print stylesheet is P0; a real PDF file is P1). |

### 4.3 Out of scope for v1 (do not build)

- Telephony. The Voice Agent API's Twilio path is inbound-only with no conferencing, so a three-party phone call is not possible today.
- Hindi speech output (not offered by the Voice Agent API yet).
- More than two human speakers.
- CRM, e-signature, policy-admin integrations.
- Multi-tenant auth, billing, user accounts.
- Storing or replaying audio.
- Training or fine-tuning any model.

---

## 5. The golden path (this is the demo video)

Setting: a bank branch. **Rahul** (relationship manager) is selling a ULIP to **Mrs. Sharma**, who speaks Hinglish. Saakshi runs on the laptop between them.

| Time | What happens | What the judge sees |
|---|---|---|
| 0:00 | Rahul selects the ULIP pack, types both names and the product name. Clicks Start. | Keyterms populate. Checkpoint Board appears, all grey. |
| 0:10 | Saakshi: "I am Saakshi, I will listen and make sure everything important is covered. Rahul, please say your name. Thank you. Mrs. Sharma, please say your name." | Speaker A becomes Advisor, Speaker B becomes Customer. |
| 0:30 | Rahul explains the plan: premium, term, market-linked. | Checkpoints tick live with quotes. Mixed-language turns show "hi+en". |
| 1:05 | Mrs. Sharma: "Isme paisa kab nikal sakti hoon?" Rahul: "Anytime, madam, and the returns are guaranteed, twelve percent." | Red flag: **Guaranteed returns (critical)**, citation shown. |
| 1:08 | Saakshi (interrupting): "Rahul, a quick flag. Returns on a market-linked plan cannot be called guaranteed, and this plan has a five-year lock-in. Mrs. Sharma, please note both." | Intervention logged with the triggering quote and a 1.9 s latency badge. |
| 1:20 | Rahul corrects himself and continues. | Violation marked *corrected*. |
| 1:50 | Rahul: "Saakshi, verify." Saakshi: "Before we finish, the thirty-day free-look period has not been mentioned." Rahul explains it. | Last checkpoint ticks. |
| 2:00 | Teach-back. Saakshi: "Mrs. Sharma, in your own words, for how long is your money locked in?" She: "Paanch saal, five years, uske baad nikal sakti hoon." Saakshi: "Correct." Three more questions; one partial on charges, Saakshi re-explains, re-asks, passes. | Teach-back panel fills with verdicts and quotes. |
| 2:45 | Certificate generated. QR and hash on screen. Verify page opens, shows VALID, then an edited copy shows TAMPERED. | The evidence table with speaker, time and quote for every row. |
| 3:00 | Cut to business case. | |

The synthetic advisor in judge-solo mode speaks Rahul's lines from this exact script.

---

## 6. Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | The system shall open one Streaming STT session (Universal-3.5 Pro, `speaker_labels=true`, `max_speakers=2`, `language_codes=[en,hi]`, `language_detection=true`, `voice_focus=far-field`) per Saakshi session, authenticated with a short-lived token minted server-side. |
| FR-2 | The system shall open one Voice Agent API session per Saakshi session, authenticated with a short-lived token, configured inline (no stored agent required) with a phase-specific system prompt, keyterms, turn detection and tools. |
| FR-3 | During OBSERVE the system shall **not** stream microphone audio to the Voice Agent session; it shall inject finalized human turns as `conversation.message` context, prefixed with the speaker role. |
| FR-4 | Every finalized STT turn shall be run through the deterministic rule layer of the active pack within 50 ms and through the LLM analyzer (LLM Gateway, strict JSON schema) within a rolling window of the last 8 turns. |
| FR-5 | A violation shall trigger an intervention only if (a) a critical deterministic pattern matched an advisor turn, or (b) the LLM analyzer returns the violation with confidence ≥ 0.8 and the rate limit allows. |
| FR-6 | An intervention shall be delivered via `reply.create` with explicit instructions containing the exact correction text, and the microphone shall be streamed to the Voice Agent for up to 8 s afterwards to capture an acknowledgement, then gated again. |
| FR-7 | The TEACHBACK phase shall swap the Voice Agent `system_prompt`, raise turn-detection silence thresholds after each question, stream microphone audio continuously, and expose the tools `record_answer` (interactive), `reexplain` (interactive) and `finish_teachback` (hold), with `finish_teachback` revealed only after at least three answers are recorded. |
| FR-8 | When the diarized STT stream attributes speech during TEACHBACK to the advisor, the system shall inject a `conversation.message` telling the agent that the advisor, not the customer, spoke. |
| FR-9 | The certificate hash chain shall be `h_0 = sha256(pack_id || pack_version || stt_session_id)` and `h_i = sha256(h_{i-1} || turn_order || speaker_role || transcript_hash || start_ms || end_ms)` over finalized turns in order, where `transcript_hash = sha256(transcript)`; the certificate hash shall be sha256 of the canonical JSON of the certificate with the `certificate_hash` field empty. |
| FR-10 | The verification page shall recompute both hashes from the stored payload and display VALID only if both match. |
| FR-11 | Judge-solo mode shall mix synthetic advisor PCM into the STT audio stream and play it to the speakers, and shall never send synthetic audio to the Voice Agent session. |
| FR-12 | All agent speech shall be captioned on screen as it is spoken, using `transcript.agent.delta`. |
| FR-13 | On `reply.done` with `status: interrupted` or on `input.speech.started`, queued agent audio shall be flushed immediately. |
| FR-14 | The system shall send `session.end` and `Terminate` on intentional exit. |

---

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Latency | Intervention audio starts ≤ 2.5 s after the violating turn's `end_of_turn` (p50 target 1.8 s). Teach-back agent reply starts ≤ 1.5 s after customer end of turn (p50). |
| Diarization | ≥ 95% of finalized turns correctly attributed on the rehearsed script with a laptop mic; manual swap always available. |
| Cost | ≤ $2 per 20-minute session: STT ≈ $0.45/hr + diarization $0.12/hr + prompting $0.05/hr + voice focus $0.10/hr; Voice Agent $4.50/hr billed only while the session is open, so open it lazily at calibration and end it at certificate. |
| Availability | No long-lived server. Browser connects directly to AssemblyAI with tokens; Vercel route handlers only mint tokens, call the LLM Gateway and store certificates. |
| Privacy | No audio persisted. Transcript kept in browser memory; only the certificate (quotes, not full transcript) is stored, keyed by an unguessable id. Optional PII redaction. |
| Accessibility | Everything the agent says is captioned. Colour is never the only signal on the board. |
| Browser support | Chromium first (24 kHz AudioContext). Firefox and Safari via worklet resampling, best effort. |
| Observability | Every WS event logged to an in-app debug drawer with timestamps; latency badges computed client-side. |

---

## 8. Success metrics

Hackathon outcome: **top-5 placement** (five equal prizes).

Live metrics shown in the app and README:

| Metric | Target |
|---|---|
| Violation detection precision / recall on the eval corpus | ≥ 0.90 / ≥ 0.80 |
| Checkpoint detection recall on the eval corpus | ≥ 0.85 |
| Intervention latency p50 | ≤ 1.8 s |
| Teach-back completion (4 questions) | ≤ 90 s |
| Cost per demo session | ≤ $1 |

---

## 9. Business case (for slides)

- **Pricing.** Per verified conversation (₹40–80, or $1–2) or per advisor seat per month. Compliance budgets, not sales budgets.
- **ROI.** A single upheld mis-selling complaint costs an insurer premium refunds, ombudsman time, agent clawbacks and a lapsed policy; regulators add fines and licence risk. IRDAI logged 26,667 such grievances in FY25 in life insurance alone. Reducing complaints and free-look cancellations by even a few percent pays for deployment across a bancassurance channel.
- **Wedge.** Bancassurance branches and telesales floors in India, where Hinglish is the default and IRDAI is publicly focused on mis-selling. Second market: UK firms assembling Consumer Duty evidence packs.
- **Competition.** Post-call QA and conversation-intelligence vendors (Observe.ai, Uniphore, Aveni in the UK) monitor and score *after* the fact. Saakshi is in the room, intervenes before harm, and produces proof of understanding rather than a score.
- **Platform.** Protocol packs make the same engine serve loan closings (RBI KFS), clinical-trial informed consent, and tenancy agreements. Insurance is the first pack, not the product.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Diarization swaps speakers on one laptop mic | `max_speakers=2`, far-field voice focus, role calibration by name, one-click swap, keep the demo mic between speakers, rehearse |
| Agent hears its own speech | Browser echo cancellation on; Voice Agent input gated during OBSERVE; flush on barge-in |
| Over-eager interventions annoy | Deterministic critical list is short; LLM threshold 0.8; 60 s rate limit; every intervention cites a rule |
| Hinglish output comes as Devanagari, breaking regexes | Patterns include Devanagari and Roman forms; LLM layer is script-agnostic; test with real turns in week one |
| Hindi TTS unavailable | English speech plus optional Hindi captions; say so honestly in the video |
| Solo builder time (HackSpire deck Sep 8, SIH idea Sep 20) | Weekly gates; P1 is cut first; video recorded by Sep 27 |
| Credits run out | Claim hackathon credits via the lablab link and confirm on the AssemblyAI dashboard activation page; keep Voice Agent sessions short; log cost per session |
| Vercel serverless cannot hold WebSockets | Browser-direct WebSockets with tokens, which is the documented pattern |

---

## 11. Submission package (lablab requirements)

| Item | Plan |
|---|---|
| Title | Saakshi — Consent You Can Prove |
| Short description | AI witness for regulated sales: hears who said what in English or Hinglish, interrupts mis-selling, runs a teach-back, and issues a verifiable Consent Certificate. Built on AssemblyAI Voice Agent API + Universal-3.5 Pro streaming. |
| Long description | Problem, insight, how it works, AssemblyAI features used (named), business case, what is next |
| Tags | AssemblyAI, Voice Agent API, Universal-3.5 Pro, Streaming STT, LLM Gateway, Next.js, Vercel, Compliance, FinTech, InsurTech |
| Cover image | 16:9 PNG, the Checkpoint Board with a red flag and Saakshi's caption |
| Video | MP4, 4–5 min: problem 0:00–0:30, golden path 0:30–3:00, business 3:00–4:00, tech and roadmap 4:00–4:45 |
| Slides | PDF, 8–10 pages: problem, insight, demo stills, architecture, AssemblyAI features, evidence and certificate, business, roadmap, team |
| Repo | Public GitHub, MIT, README with architecture and one-command setup |
| Demo | Vercel URL, judge-solo mode on by default |

---

## 12. Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-09-05 | Name: Saakshi. Tagline: Consent you can prove. | Meaning fits; easy to say; Indian judges will recognise it |
| 2026-09-05 | Insurance ULIP sale is the deep demo; loan KFS is the second pack | Highest complaint volume, strongest regulatory pull, Prudential and Amex judges |
| 2026-09-05 | Agent speaks English; understands Hinglish | Hindi TTS not available in the Voice Agent API |
| 2026-09-05 | No telephony | Twilio path is inbound-only, no conferencing |
| 2026-09-05 | Browser-direct WebSockets, Next.js on Vercel | Vercel cannot hold WS; documented AssemblyAI pattern |
| 2026-09-05 | Two-layer analyzer (rules + LLM) | Instant reaction on critical patterns, nuance from the LLM, no fabricated rules |

---

## 13. Sources

- lablab.ai event page: https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon
- lablab.ai rule book and winning guide: https://lablab.ai/hackathon-rules , https://lablab.ai/guide/how-to-win-an-ai-hackathon
- FCA consumer understanding review (Mar 2026) and Consumer Duty: https://www.fca.org.uk/publications/good-and-poor-practice/consumer-understanding-good-practice-areas-improvement , https://www.fca.org.uk/firms/consumer-duty/about
- IRDAI FY25 mis-selling grievances: https://www.business-standard.com/finance/insurance/misselling-grievances-against-life-insurers-up-14-in-fy25-says-irdai-126010101087_1.html
- IRDAI Protection of Policyholders Regulations 2024 (30-day free look, benefit illustration): https://www.amsshardul.com/insight/simplified-norms-to-protect-policyholders/
- RBI Key Facts Statement mandate (Oct 1 2024): https://vinodkothari.com/2024/04/the-key-to-loan-transparency-rbi-frames-kfs-norms-for-all-retail-and-msme-loans/
- India life insurance FY25 new business premium and agent counts: https://www.indiainfoline.com/blog/fy25-new-business-premium-grows-5-falls-short-of-4-trillion , https://cafemutual.com/news/insurance/33464-hdfc-life-lic-and-tata-aia-life-add-highest-number-of-agents-in-april-sept-2024
- AssemblyAI docs: https://www.assemblyai.com/docs/voice-agents/voice-agent-api , https://www.assemblyai.com/docs/streaming/api-spec/streaming-websocket , https://www.assemblyai.com/docs/llm-gateway/quickstart
- AssemblyAI credits activation (login required): https://www.assemblyai.com/dashboard/activation
