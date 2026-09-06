import { buildCertificateDraft } from "@/lib/cert/build";
import type { StoreCertificateResponse } from "@/lib/cert/schema";
import type { RoomController } from "./controller";
import { finalTurns } from "./transcript";

// CERTIFY phase (prd.md P0-8, FR-9, FR-10). The browser builds the draft and hashes the chain; the
// server assigns the id, recomputes both proofs and refuses a certificate that does not verify.
// The closing line goes back inside the finish_teachback tool result, which in hold mode is what
// fires the agent's next reply, so nothing here sends reply.create.

const CERTIFY_TIMEOUT_MS = 10_000;

export async function certifySession(c: RoomController, callId: string | null): Promise<void> {
  c.set({ certificate: { status: "building" } });
  try {
    const stored = await buildAndStore(c);
    c.log("client", "certificate.stored", { id: stored.id, url: stored.url });
    c.set({
      certificate: {
        status: "stored",
        id: stored.id,
        hash: stored.certificate_hash,
        url: stored.url,
      },
    });
    c.set((s) => ({ teachback: s.teachback && { ...s.teachback, status: "done" } }));
    const line = closingLine(c);
    c.recentAgentSpeech.push(line);
    if (callId) c.toolResults.sendNow(c, { callId, result: { ok: true, say_exactly: line } });
    else c.speakExact(line);
    c.dispatch({ type: "CERTIFIED" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    c.log("client", "certificate.error", { message });
    c.set({ certificate: { status: "error", error: message } });
    c.set((s) => ({ teachback: s.teachback && { ...s.teachback, status: "done" } }));
    // The room still closes politely; the operator sees the failure on the certificate card.
    const line = "Thank you. I could not store the certificate, so please save the record here.";
    c.recentAgentSpeech.push(line);
    if (callId) {
      c.toolResults.sendNow(c, {
        callId,
        result: { error: message, say_exactly: line },
        isError: true,
      });
    } else c.speakExact(line);
  }
}

async function buildAndStore(c: RoomController): Promise<StoreCertificateResponse> {
  const s = c.state;
  if (!c.pack || !s.board) throw new Error("no pack or board");
  const startedAt = s.startedAt ?? new Date().toISOString();
  const draft = await buildCertificateDraft({
    pack: c.pack,
    board: s.board,
    turns: finalTurns(s.transcript),
    answers: s.teachback?.answers ?? [],
    setup: s.setup,
    session: {
      startedAt,
      endedAt: new Date().toISOString(),
      sttSessionId: s.status.earsSessionId ?? "",
      agentSessionId: s.status.mouthSessionId ?? "",
      gaps: s.gaps.map((g) => ({
        from: new Date(Date.parse(startedAt) + g.fromMs).toISOString(),
        to: new Date(Date.parse(startedAt) + g.toMs).toISOString(),
        reason: `socket closed ${g.code}`,
      })),
    },
    interventions: s.interventionsLog,
    // Default true: a demo record must never be mistaken for a real consent, so the flag is
    // only cleared when the deployment explicitly says this is a live room.
    demo: process.env.NEXT_PUBLIC_JUDGE_SOLO_MODE !== "false",
  });

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CERTIFY_TIMEOUT_MS);
  try {
    const res = await fetch("/api/certificate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
      signal: abort.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`certificate responded ${res.status} ${detail.slice(0, 160)}`);
    }
    return (await res.json()) as StoreCertificateResponse;
  } finally {
    clearTimeout(timer);
  }
}

/** Under 25 words, no markdown, no exclamation marks (CLAUDE.md). */
function closingLine(c: RoomController): string {
  const answers = c.state.teachback?.answers ?? [];
  const understood = answers.filter((a) => a.verdict === "understood").length;
  const name = c.state.setup.customerName;
  return `Thank you ${name}. You answered ${understood} of ${answers.length} clearly. The consent certificate is ready to verify.`;
}
