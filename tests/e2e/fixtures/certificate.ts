import { expect } from "@playwright/test";

// One certificate draft, shared by the verification spec and the design inspection run, so the
// two never drift apart. No AssemblyAI is needed: the draft is posted to the API and the page
// recomputes both proofs from what was stored.
export const draft = {
  version: "1.0",
  pack: { id: "insurance-ulip-in", version: "1.0.0", jurisdiction: "IN" },
  parties: { advisor: "Rahul", customer: "Mrs. Sharma" },
  product: { name: "SecureGrowth ULIP" },
  session: {
    started_at: "2026-09-06T09:00:00.000Z",
    ended_at: "2026-09-06T09:04:00.000Z",
    stt_session_id: "stt-e2e",
    agent_session_id: "sess-e2e",
    gaps: [],
  },
  checkpoints: [
    {
      id: "lock_in_5y",
      label: "Five-year lock-in",
      status: "met",
      evidence: {
        turn_order: 2,
        speaker_role: "advisor",
        start_ms: 61000,
        end_ms: 64000,
        quote: "There is a five year lock-in on this plan.",
        language: "en",
      },
      citation: {
        authority: "IRDAI",
        instrument: "IRDAI (Unit Linked Insurance Products) Regulations, 2019",
        clause: "Five-year lock-in period",
      },
    },
    {
      id: "free_look_30",
      label: "Thirty-day free look",
      status: "missing",
      citation: {
        authority: "IRDAI",
        instrument: "Protection of Policyholders' Interests Regulations, 2024",
        clause: "Free look period of 30 days",
      },
    },
  ],
  violations: [
    {
      id: "guaranteed_returns",
      label: "Guaranteed or assured returns",
      severity: "critical",
      evidence: {
        turn_order: 3,
        speaker_role: "advisor",
        start_ms: 65000,
        end_ms: 68000,
        quote: "the returns are guaranteed, twelve percent",
        language: "en",
      },
      citation: {
        authority: "IRDAI",
        instrument: "Insurance Advertisements and Disclosure Regulations, 2021",
        clause: "No statement that returns are guaranteed",
      },
      intervention: {
        spoken_text:
          "Rahul, a quick flag. Returns on a market-linked plan cannot be called guaranteed.",
        latency_ms: 1533,
        acknowledged: true,
      },
      resolution: "corrected",
    },
  ],
  teachback: [
    {
      question_id: "q1",
      question: "In your own words, for how long is your money locked in?",
      topic: "lock_in",
      verdict: "understood",
      customer_quote: "पाँच साल, five years",
      reexplained: false,
    },
  ],
  // An empty turn digest still has a chain head: sha256(pack id | pack version | stt session id).
  turns: [] as Array<Record<string, unknown>>,
  turns_digest: {
    count: 0,
    chain_head: "dc7b71f6f0d09e1695d546bd5840b27a89923b79b31a701a2137ce8b038b5c7a",
  },
  language_mix: "mixed",
  demo: true,
  created_at: "2026-09-06T09:04:10.000Z",
};

export async function storeCertificate(
  request: import("@playwright/test").APIRequestContext,
): Promise<{ id: string; certificate_hash: string; url: string }> {
  const res = await request.post("/api/certificate", { data: draft });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}
