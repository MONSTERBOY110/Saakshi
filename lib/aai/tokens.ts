import "server-only";
import { z } from "zod";

// Verified against the AssemblyAI docs on 2026-09-05:
// - Streaming token: GET streaming.assemblyai.com/v3/token, header "Authorization: <key>" (no Bearer).
// - Voice Agent token: GET agents.assemblyai.com/v1/token, header "Authorization: Bearer <key>", single use.
const SttTokenSchema = z.object({
  token: z.string().min(1),
  expires_in_seconds: z.number().int().positive(),
});
const AgentTokenSchema = z.object({ token: z.string().min(1) });

export type SttToken = z.infer<typeof SttTokenSchema>;
export type AgentToken = z.infer<typeof AgentTokenSchema>;

export const TOKEN_EXPIRES_IN_SECONDS = 60;
export const MAX_SESSION_DURATION_SECONDS = 3600;

function apiKey(): string {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error("ASSEMBLYAI_API_KEY missing");
  return key;
}

function query(): string {
  return `expires_in_seconds=${TOKEN_EXPIRES_IN_SECONDS}&max_session_duration_seconds=${MAX_SESSION_DURATION_SECONDS}`;
}

export async function mintSttToken(fetchImpl: typeof fetch = fetch): Promise<SttToken> {
  const res = await fetchImpl(`https://streaming.assemblyai.com/v3/token?${query()}`, {
    headers: { Authorization: apiKey() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`stt token mint failed: ${res.status}`);
  return SttTokenSchema.parse(await res.json());
}

export async function mintAgentToken(fetchImpl: typeof fetch = fetch): Promise<AgentToken> {
  const res = await fetchImpl(`https://agents.assemblyai.com/v1/token?${query()}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`agent token mint failed: ${res.status}`);
  return AgentTokenSchema.parse(await res.json());
}
