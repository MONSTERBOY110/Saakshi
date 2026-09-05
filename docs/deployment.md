# Saakshi deployment guide

How to take Saakshi from this repository to a live, judge-ready URL on Vercel, and how to know it
worked. Written for the project owner on 2026-09-06 (Phase 0). Everything here is a repeatable
procedure; nothing is stored in the browser or on the server except certificates (Phase 3).

## 1. What gets deployed

| Piece | Where it runs | Notes |
|---|---|---|
| Next.js 15 app (landing, `/session`, later `/verify/[id]`) | Vercel, static pages plus Node route handlers | Built with `pnpm build` |
| `/api/token/stt`, `/api/token/agent` | Vercel Node functions | Mint single-use AssemblyAI tokens, 60 s redeem window, 20 requests per minute per IP |
| Streaming STT and Voice Agent WebSockets | Browser to AssemblyAI directly | Vercel never holds a socket; the API key never leaves the server |
| Certificate store (Phase 3) | Upstash Redis via the Vercel Marketplace | In-memory fallback when the KV variables are empty |

Branching model chosen by the owner: a single `main` branch, pushed by the owner. Every push to
`main` is a production deployment. There are no feature branches or pull-request previews, so the
verification steps in section 6 run against production after each push.

Current production deployment: https://saakshi-1.vercel.app (Vercel project `saakshi-1`, first deployed 2026-09-06 00:50 IST, verified with section 6 the same night).

## 2. Prerequisites

- GitHub repository `MONSTERBOY110/Saakshi` (public, MIT).
- A Vercel account with GitHub access. The Hobby plan is enough for the hackathon.
- AssemblyAI account with the hackathon credits activated at
  https://www.assemblyai.com/dashboard/activation and one API key. The same key serves Streaming
  STT, the Voice Agent API and the LLM Gateway.
- Locally: Node 20 or newer, pnpm 10 (`npm i -g pnpm@10`), the repo cloned, `.env` filled from
  `.env.example`. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` must pass before a push.

## 3. Environment variables

Set these in Vercel under Project, Settings, Environment Variables, for both Production and
Preview (previews are unused for now, but set both so a future branch works). Values marked
secret must be added as sensitive variables.

| Variable | Value | Scope | Notes |
|---|---|---|---|
| `ASSEMBLYAI_API_KEY` | your key | secret, server only | Never prefix with `NEXT_PUBLIC_`. |
| `LLM_GATEWAY_BASE_URL` | `https://llm-gateway.assemblyai.com/v1` | server | Phase 2 onward. |
| `LLM_ANALYZER_MODEL` | `gemini-3.5-flash-lite` | server | Phase 2. |
| `LLM_ANALYZER_FALLBACK_MODEL` | `claude-haiku-4-5-20251001` | server | Phase 2. |
| `LLM_QUESTIONS_MODEL` | `claude-sonnet-4-6` | server | Phase 3. |
| `KV_REST_API_URL` | injected by the Upstash integration | server | Phase 3; leave unset until then. |
| `KV_REST_API_TOKEN` | injected by the Upstash integration | secret | Phase 3. |
| `NEXT_PUBLIC_APP_URL` | the production URL, currently `https://saakshi-1.vercel.app` | public | Used inside certificates and QR codes (Phase 3). Update if the domain changes. |
| `NEXT_PUBLIC_DEFAULT_PACK` | `insurance-ulip-in` | public | |
| `NEXT_PUBLIC_JUDGE_SOLO_MODE` | `true` | public | Judge-solo mode on by default (Phase 4). |

GitHub Actions needs no secrets: CI builds with `ASSEMBLYAI_API_KEY=ci-dummy` and never calls
AssemblyAI. Live tests are opt-in and run only from a developer machine.

## 4. First deployment (Vercel dashboard)

1. Push `main` to GitHub. Confirm the CI workflow is green on the commit
   (repository, Actions tab).
2. Go to https://vercel.com/new, choose Import Git Repository, pick `MONSTERBOY110/Saakshi`.
3. Settings on the import screen:
   - Framework Preset: Next.js (auto-detected).
   - Root Directory: `/`.
   - Build Command and Output: leave defaults (`next build`).
   - Install Command: leave default. Vercel reads `pnpm-lock.yaml` and the `packageManager`
     field and uses pnpm 10.
   - Node.js Version (after import, under Settings, General): 20.x or 22.x. Both are supported by
     `engines.node >= 20`.
4. Add the environment variables from section 3 before the first build, or add them and
   redeploy.
5. Click Deploy. The first build takes two to three minutes. You get a production URL
   `https://<project>.vercel.app`.
6. Set `NEXT_PUBLIC_APP_URL` to that URL and redeploy (Deployments, three-dot menu, Redeploy).

### Alternative: Vercel CLI from this machine

Run these yourself in the Claude Code prompt with the `!` prefix, because the login is
interactive:

```bash
! npx vercel login
! npx vercel link            # choose the existing project or create one named saakshi
! npx vercel env pull .env.local   # optional: mirror the dashboard variables locally
! npx vercel --prod          # deploy the current working tree to production
```

Prefer the GitHub integration for day-to-day work; the CLI is for emergencies.

## 5. Upstash Redis (Phase 3, spike S10)

1. In the Vercel project, open Storage, Create Database, choose Upstash Redis from the
   Marketplace, region closest to Mumbai (`ap-south-1`) or the Vercel function region.
2. Connect it to the project. The integration injects `KV_REST_API_URL`, `KV_REST_API_TOKEN`
   (and read-only variants) into all environments.
3. Redeploy. Until Phase 3 ships `/api/certificate`, nothing reads these variables.
4. Free tier limits are far above a hackathon's needs (certificates are a few KB each, 90-day TTL).

## 6. Verify a deployment like a judge

Do this after every push to `main`.

1. **Token routes.** From any terminal:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://<url>/api/token/stt      # expect 200
   curl -s -o /dev/null -w "%{http_code}\n" https://<url>/api/token/agent    # expect 200
   ```
   A `502` means the key is missing or invalid on Vercel, or the credits are exhausted.
   Check Vercel, Deployments, Functions logs for `[token/stt]`.
2. **Fresh browser profile.** Windows PowerShell:
   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="$env:TEMP\saakshi-fresh" https://<url>/session
   ```
   Click Start, allow the microphone, and check the three chips: Mic `24000 Hz`, Ears `open`,
   Mouth `ready`. You should hear the greeting and see it captioned. Open the debug drawer and
   filter for `Begin` and `session.ready`. Click Stop and confirm `Termination` and
   `session.ended` appear and the phase badge reads `stopped`.
3. **Automated smoke against production.**
   ```bash
   PLAYWRIGHT_BASE_URL=https://<url> pnpm exec playwright test tests/e2e/smoke.spec.ts
   ```
4. **Automated live check against production** (costs a few cents; the deployed routes mint the
   tokens, so this also proves the Vercel environment variables are correct):
   ```bash
   PLAYWRIGHT_BASE_URL=https://<url> SAAKSHI_LIVE_E2E=1 pnpm exec playwright test tests/e2e/dual-session.live.spec.ts
   ```
5. **Rate limit.** Twenty-one quick requests to `/api/token/stt` from one IP should end with a
   `429`. The limiter is per serverless instance, so a cold second instance may allow more; this
   is acceptable for the demo and documented in `lib/server/rate-limit.ts`.

## 7. Operating notes

- **Cost.** The Voice Agent bills while a session is open (about $4.50 per hour). The app sends
  `session.end` on Stop so the 30-second billable resume window is skipped. Streaming STT with
  diarization, prompting and Voice Focus is about $0.72 per hour. A 20-minute demo is about $0.90.
- **Privacy.** No audio is stored or logged. The debug drawer strips base64 audio to its length.
  Only certificates (quotes, timestamps, hashes) will be stored, from Phase 3.
- **Browsers.** Chromium is the supported path (24 kHz AudioContext). Firefox and Safari fall back
  to the default rate with resampling in the worklet; spike S9 confirms whether that is good
  enough.
- **Microphone access needs HTTPS.** Vercel is HTTPS; `localhost` also counts as secure.
- **Rollback.** Vercel, Deployments, pick the previous good deployment, Promote to Production.
  Instant, no rebuild.
- **Logs.** Vercel, Deployments, a deployment, Functions tab shows route handler logs. Client-side
  socket events are only in the in-app debug drawer (export them as JSON when reporting a bug).

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/api/token/*` returns 502 `token_mint_failed` | `ASSEMBLYAI_API_KEY` missing on Vercel, wrong value, or no credits | Set the variable for Production, redeploy; check the activation page |
| Socket closes with 1008 right after Start | Token expired before the socket opened (60 s window) or key invalid | Retry Start; the app mints a fresh token per attempt |
| Ears chip stays `connecting` | Corporate network blocking `wss://streaming.assemblyai.com` | Try another network or hotspot |
| STT socket closes with 3007 | Audio faster than real time or frames outside 50 to 1000 ms | Should not happen with the worklet; report with the drawer export |
| Mouth `ready` but no sound | Browser autoplay policy or muted tab | Start is a user gesture that resumes the AudioContext; check the tab is not muted |
| Agent hears itself and interrupts | Echo cancellation off or external speakers too loud | Keep `echoCancellation: true` (it is), lower speaker volume, use a headset for the recording |
| Mic chip shows `48000 Hz` | Firefox or Safari, or a device that refused 24 kHz | Expected fallback; the worklet resamples |
| CI fails on `pnpm install --frozen-lockfile` | `package.json` changed without updating the lockfile | Run `pnpm install` locally and commit `pnpm-lock.yaml` |
| Build passes locally but fails on Vercel | Node version mismatch | Set Node.js Version to 20.x or 22.x in project settings |

## 9. Submission-day checklist (Phase 6)

- Production URL opens the mic and both sessions in a fresh Chromium profile.
- Judge-solo mode is on by default (`NEXT_PUBLIC_JUDGE_SOLO_MODE=true`).
- `NEXT_PUBLIC_APP_URL` matches the production domain so certificate QR codes resolve.
- A stored certificate's `/verify/[id]` shows VALID, and a tampered copy shows TAMPERED.
- README links to the live URL; repository is public; `LICENSE` is MIT.
- Screenshot of the lablab submission confirmation saved in `docs/`.
