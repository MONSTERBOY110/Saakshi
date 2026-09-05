import { sanitizeKeyterms } from "@/lib/aai/stt-url";
import { fixtureExport } from "./log";
import { normalize, VERBATIM_LINE, withTimeout, type SpikeHost } from "./spike-state";

// Buttons on the spike page (trd.md section 17: S3, S4, S5) plus keyterm updates and export.

export function replyNow(host: SpikeHost, instructions: string): void {
  if (!host.mouth?.sendJson({ type: "reply.create", instructions })) return;
  host.pendingReplyAt = performance.now();
  host.log("client", "reply.create", { instructions });
}

export function injectFact(host: SpikeHost, content: string): void {
  if (host.mouth?.sendJson({ type: "conversation.message", role: "system", content })) {
    host.log("client", "conversation.message", { role: "system", content });
  }
}

export function forceEndpoint(host: SpikeHost): void {
  if (host.ears?.sendJson({ type: "ForceEndpoint" })) host.log("client", "ForceEndpoint", {});
}

export function updateKeyterms(host: SpikeHost, terms: string[]): void {
  const keyterms = sanitizeKeyterms(terms);
  if (host.ears?.sendJson({ type: "UpdateConfiguration", keyterms_prompt: keyterms })) {
    host.log("client", "UpdateConfiguration", { keyterms_prompt: keyterms });
  }
  if (host.mouth?.sendJson({ type: "session.update", session: { input: { keyterms } } })) {
    host.log("client", "session.update", { input: { keyterms } });
  }
}

/** S5: ask the agent to say one fixed line n times and count exact matches. */
export async function verbatimTrial(host: SpikeHost, n: number): Promise<void> {
  if (!host.mouth) return;
  host.set({ verbatim: { expected: VERBATIM_LINE, outputs: [], matches: 0, running: true } });
  for (let i = 0; i < n; i++) {
    const spoken = new Promise<string>((res) => (host.waiters.agentText = res));
    replyNow(host, `Say exactly this and nothing else: ${VERBATIM_LINE}`);
    const text = await withTimeout(spoken, 25_000, "<timeout>");
    host.waiters.agentText = undefined;
    const match = normalize(text) === normalize(VERBATIM_LINE);
    host.set((s) =>
      s.verbatim
        ? {
            verbatim: {
              ...s.verbatim,
              outputs: [...s.verbatim.outputs, text],
              matches: s.verbatim.matches + (match ? 1 : 0),
            },
          }
        : {},
    );
    // Leave a gap so the next reply is not treated as barge-in on the previous one.
    await new Promise((r) => setTimeout(r, 1500));
  }
  host.set((s) => (s.verbatim ? { verbatim: { ...s.verbatim, running: false } } : {}));
}

export function exportFixtures(host: SpikeHost): void {
  const blob = new Blob([JSON.stringify(fixtureExport(host.state.events), null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `saakshi-fixtures-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
