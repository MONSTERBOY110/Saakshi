import { describe, expect, it } from "vitest";
import { verifyCertificate } from "@/lib/cert/chain";
import { buildCertificateDraft, finaliseCertificate } from "@/lib/cert/build";
import { CertificateDraftSchema, CertificateSchema } from "@/lib/cert/schema";
import { getPack } from "@/lib/rules/load";
import { rebuildBoard, setViolationLatency, acknowledgeViolation } from "@/lib/session/board";
import type { StoredTurn } from "@/lib/session/transcript";
import type { TeachbackAnswer } from "@/lib/session/store";

const pack = getPack("insurance-ulip-in");

const turn = (
  order: number,
  role: "advisor" | "customer" | undefined,
  text: string,
  extra: Partial<StoredTurn> = {},
): StoredTurn => ({
  order,
  text,
  final: true,
  formatted: true,
  speakerLabel: role === "advisor" ? "A" : role === "customer" ? "B" : "PENDING",
  role,
  language: "en",
  startMs: order * 4000,
  endMs: order * 4000 + 3000,
  words: [],
  revised: false,
  pending: role === undefined,
  ...extra,
});

const turns: StoredTurn[] = [
  turn(0, "advisor", "Good morning, my name is Rahul."),
  turn(1, "customer", "Namaste, my name is Mrs. Sharma."),
  turn(
    2,
    "advisor",
    "You pay a premium of fifty thousand every year for ten years, policy term fifteen years.",
  ),
  turn(3, "advisor", "The money is market-linked and there is a five year lock-in."),
  turn(4, "advisor", "Anytime, madam, and the returns are guaranteed, 12%."),
  turn(5, "advisor", "Sorry, let me correct that. Returns are not guaranteed."),
  turn(6, "advisor", "There are charges, including premium allocation and fund management."),
  turn(
    7,
    "advisor",
    "The illustration shows four percent and eight percent, and the surrender value after the lock-in.",
  ),
  turn(8, "advisor", "You have a thirty day free look period to return the policy."),
  turn(9, undefined, "Saakshi speaking.", { echo: true }),
];

const answers: TeachbackAnswer[] = [
  {
    questionId: "q1",
    question: "For how long is your money locked in?",
    topic: "lock_in",
    verdict: "understood",
    customerQuote: "पाँच साल, five years",
    turnOrder: 10,
    reexplained: false,
  },
  {
    questionId: "q2",
    question: "What charges will you pay?",
    topic: "charges",
    verdict: "partial",
    customerQuote: "kuch charges hain",
    turnOrder: 11,
    reexplained: true,
  },
];

function roomState() {
  const board = acknowledgeViolation(
    setViolationLatency(rebuildBoard(pack, turns), "guaranteed_returns@4", 1533),
    "withdraw_anytime@4",
  );
  return {
    pack,
    board,
    turns,
    answers,
    setup: {
      packId: pack.id,
      advisorName: "Rahul",
      customerName: "Mrs. Sharma",
      productName: "SecureGrowth ULIP",
      productTerms: ["SecureGrowth"],
      judgeSolo: false,
    },
    session: {
      startedAt: "2026-09-06T09:00:00.000Z",
      endedAt: "2026-09-06T09:04:00.000Z",
      sttSessionId: "stt-1",
      agentSessionId: "sess_agent_1",
      gaps: [{ from: "2026-09-06T09:02:00.000Z", to: "2026-09-06T09:02:03.000Z", reason: "1006" }],
    },
    interventions: [
      {
        key: "guaranteed_returns@4",
        spokenText:
          "Rahul, a quick flag. Returns on a market-linked plan cannot be called guaranteed.",
        latencyMs: 1533,
        acknowledged: false,
      },
    ],
    demo: true,
  };
}

describe("buildCertificateDraft", () => {
  it("produces a draft that satisfies the schema", async () => {
    const draft = await buildCertificateDraft(roomState());
    const parsed = CertificateDraftSchema.safeParse(draft);
    expect(parsed.success, parsed.success ? "" : parsed.error.message).toBe(true);
  });

  it("names the parties, the product and the pack", async () => {
    const draft = await buildCertificateDraft(roomState());
    expect(draft.parties).toMatchObject({ advisor: "Rahul", customer: "Mrs. Sharma" });
    expect(draft.product.name).toBe("SecureGrowth ULIP");
    expect(draft.pack).toMatchObject({
      id: "insurance-ulip-in",
      version: "1.0.0",
      jurisdiction: "IN",
    });
    expect(draft.demo).toBe(true);
  });

  it("carries every checkpoint with its citation, and evidence where it was met", async () => {
    const draft = await buildCertificateDraft(roomState());
    expect(draft.checkpoints).toHaveLength(pack.checkpoints.length);
    const lockIn = draft.checkpoints.find((c) => c.id === "lock_in_5y");
    expect(lockIn?.status).toBe("met");
    expect(lockIn?.evidence?.quote).toContain("five year lock-in");
    expect(lockIn?.citation.authority).toBe("IRDAI");
    for (const c of draft.checkpoints) {
      if (c.status === "missing") expect(c.evidence).toBeUndefined();
    }
  });

  it("records violations with their resolution and the spoken intervention", async () => {
    const draft = await buildCertificateDraft(roomState());
    const guaranteed = draft.violations.find((v) => v.id === "guaranteed_returns");
    expect(guaranteed?.resolution).toBe("corrected");
    expect(guaranteed?.intervention).toMatchObject({ latency_ms: 1533, acknowledged: false });
    expect(guaranteed?.intervention?.spoken_text).toContain("cannot be called guaranteed");
    expect(draft.violations.find((v) => v.id === "withdraw_anytime")?.resolution).toBe(
      "acknowledged",
    );
  });

  it("keeps the teach-back answers with verdicts, quotes and the re-explain marker", async () => {
    const draft = await buildCertificateDraft(roomState());
    expect(draft.teachback.map((t) => `${t.question_id}:${t.verdict}`)).toEqual([
      "q1:understood",
      "q2:partial",
    ]);
    expect(draft.teachback[0]?.customer_quote).toBe("पाँच साल, five years");
    expect(draft.teachback[1]?.reexplained).toBe(true);
  });

  it("stores a turn digest with no transcripts, excluding echo turns", async () => {
    const draft = await buildCertificateDraft(roomState());
    expect(draft.turns).toHaveLength(9); // the echo turn is not evidence
    expect(draft.turns.every((t) => /^[0-9a-f]{64}$/.test(t.transcript_hash))).toBe(true);
    const asText = JSON.stringify(draft.turns);
    expect(asText).not.toContain("guaranteed");
    expect(asText).not.toContain("Namaste");
    expect(draft.turns_digest.count).toBe(9);
  });

  it("records the session window, ids and any gaps", async () => {
    const draft = await buildCertificateDraft(roomState());
    expect(draft.session).toMatchObject({
      stt_session_id: "stt-1",
      agent_session_id: "sess_agent_1",
      started_at: "2026-09-06T09:00:00.000Z",
    });
    expect(draft.session.gaps).toHaveLength(1);
  });

  it("summarises the language mix from the turns", async () => {
    const mixed = roomState();
    mixed.turns = [...turns, turn(10, "customer", "पाँच साल, five years", { language: "hi+en" })];
    const draft = await buildCertificateDraft(mixed);
    expect(draft.language_mix).toBe("mixed");
  });
});

describe("finaliseCertificate", () => {
  it("adds the id and a hash that verifies", async () => {
    const draft = await buildCertificateDraft(roomState());
    const cert = await finaliseCertificate(draft, "cert-abcdefgh");
    expect(CertificateSchema.safeParse(cert).success).toBe(true);
    expect(cert.id).toBe("cert-abcdefgh");
    await expect(verifyCertificate(cert)).resolves.toEqual({
      valid: true,
      chainOk: true,
      hashOk: true,
    });
  });

  it("fails verification after a one-character edit of a quote", async () => {
    const draft = await buildCertificateDraft(roomState());
    const cert = await finaliseCertificate(draft, "cert-abcdefgh");
    const first = cert.checkpoints.find((c) => c.evidence);
    const tampered = {
      ...cert,
      checkpoints: cert.checkpoints.map((c) =>
        c.id === first?.id && c.evidence
          ? { ...c, evidence: { ...c.evidence, quote: `${c.evidence.quote} (edited)` } }
          : c,
      ),
    };
    const result = await verifyCertificate(tampered);
    expect(result.valid).toBe(false);
    expect(result.hashOk).toBe(false);
  });
});
