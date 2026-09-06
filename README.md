# Saakshi

**Consent you can prove.**

Live: https://saakshi-1.vercel.app (Chromium recommended; allow the microphone on `/session`).

Saakshi is an AI witness that sits in on regulated sales conversations, knows who said what in English or Hinglish, speaks up within two seconds when a customer is about to be misled, runs a teach-back with the customer, and ends by issuing a hash-chained Consent Certificate that anyone can verify. It uses AssemblyAI Streaming STT (Universal-3.5 Pro, diarized) as its ears, the Voice Agent API as its mouth, and the LLM Gateway for structured analysis. Built for the lablab.ai x AssemblyAI Voice Agent Hackathon, September 2026.

## Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser (Next.js app on Vercel)"]
    MIC[Mic AudioWorklet<br/>PCM16 mono 24 kHz] --> MIX[Audio Router / Mixer]
    SYN[Synthetic advisor PCM<br/>judge-solo mode] --> MIX
    MIX -->|binary PCM, 50 ms| EARS[Ears client<br/>Streaming STT WS]
    MIX -->|base64 PCM, 50 ms<br/>gated by phase| MOUTH[Mouth client<br/>Voice Agent WS]
    EARS --> SM[Session State Machine]
    MOUTH --> SM
    SM --> RULES[Rule Engine<br/>protocol pack, deterministic]
    SM --> UI[Checkpoint Board · Transcript · Teach-back · Certificate]
    MOUTH -->|reply.audio| SPK[Speaker playback + flush]
  end
  subgraph Vercel["Vercel route handlers (Node)"]
    T1[/api/token/stt/]
    T2[/api/token/agent/]
    AN[/api/analyze/]
    QG[/api/teachback/questions/]
    CERT[/api/certificate/]
    VER[/verify/id page/]
  end
  subgraph AAI["AssemblyAI"]
    STT[(streaming.assemblyai.com/v3/ws<br/>universal-3-5-pro · speaker_labels)]
    VA[(agents.assemblyai.com/v1/ws<br/>Voice Agent API)]
    LLM[(llm-gateway.assemblyai.com/v1<br/>structured outputs)]
  end
  EARS <--> STT
  MOUTH <--> VA
  SM --> AN --> LLM
  SM --> QG --> LLM
  SM --> CERT --> KV[(Upstash Redis)]
  VER --> KV
  T1 -.mint token.-> STT
  T2 -.mint token.-> VA
```

## Setup

```bash
pnpm install
cp .env.example .env.local   # fill ASSEMBLYAI_API_KEY
pnpm dev                     # http://localhost:3000
pnpm test                    # vitest unit tests
pnpm test:e2e                # playwright with a fake mic
pnpm lint && pnpm typecheck && pnpm build
```

## Deployment

See `docs/deployment.md` for the Vercel setup, environment variables, Upstash, and the post-deploy verification steps.

## Status

Phase 2 (Mouth, analyzer and intervention), 2026-09-06. The session room calibrates roles by name, shows a role-coloured diarized transcript with language tags, and ticks the ULIP disclosures and flags prohibited claims from a versioned protocol pack (`packs/insurance-ulip-in.json`). When a critical claim is confirmed, Saakshi speaks the pack correction, shows how long it took from the end of the advisor speech to her first sound, and waits for an acknowledgement. "Saakshi, verify" reads whatever disclosure is still missing. Both AssemblyAI sessions run from the browser: Streaming STT
(Universal-3.5 Pro, diarized, English and Hindi) as the ears and the Voice Agent API as the mouth, with
server-minted single-use tokens. Spike results and every verified payload shape are in
`docs/decisions.md`; recorded fixtures are in `tests/fixtures/`.

Live checks against AssemblyAI (need `ASSEMBLYAI_API_KEY` in `.env`, cost a few cents):

```bash
pnpm test:e2e:live         # both sockets open, Chromium fake mic
pnpm fixtures:wav          # two-voice WAV of the demo script (offline Windows voices)
pnpm test:e2e:golden       # golden path: calibration, board, interruption, nudge
pnpm fixtures:wav:latency  # probe WAV that repeats the critical claim
pnpm test:e2e:latency      # intervention latency over several interventions
pnpm eval:analyzer         # layer-2 accuracy over ten labelled dialogues
node scripts/spike-agent-context.mjs 300000   # Voice Agent context and idle spikes, headless
```

## Licence

MIT.
