import { expect, test } from "@playwright/test";

// The public verification page (P0-9, FR-10). No AssemblyAI needed: the certificate is posted to
// the API, then the page recomputes both proofs from the stored payload.
const draft = {
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

test.describe("consent certificate verification", () => {
  test("a stored certificate reads VALID and shows its evidence", async ({ page, request }) => {
    const body = await storeCertificate(request);
    await page.goto(`/verify/${body.id}`);

    await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "valid");
    await expect(page.getByTestId("verdict")).toContainText("VALID");
    await expect(
      page.getByText(body.certificate_hash.slice(0, 16), { exact: false }),
    ).toBeVisible();

    // Every claim carries a speaker, a time and the words.
    const lockIn = page.locator('[data-testid="cert-checkpoint"][data-id="lock_in_5y"]');
    await expect(lockIn).toContainText("five year lock-in");
    await expect(lockIn).toContainText("01:01");
    await expect(
      page.locator('[data-testid="cert-checkpoint"][data-id="free_look_30"]'),
    ).toContainText("not mentioned");
    const violation = page.locator('[data-testid="cert-violation"][data-id="guaranteed_returns"]');
    await expect(violation).toContainText("1533 ms");
    await expect(violation).toContainText("corrected");
    await expect(page.getByTestId("cert-teachback")).toContainText("पाँच साल");
  });

  test("an altered copy reads TAMPERED and says the stored record is untouched", async ({
    page,
    request,
  }) => {
    const body = await storeCertificate(request);
    await page.goto(`/verify/${body.id}`);
    await page.getByTestId("tamper-link").click();

    await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "tampered");
    await expect(page.getByTestId("verdict")).toContainText("TAMPERED");
    await expect(page.getByTestId("verdict")).toContainText("does not match the stored body");
    await expect(page.getByTestId("tamper-notice")).toContainText("stored record is untouched");

    // The original is still valid.
    await page.getByRole("link", { name: "see the original" }).click();
    await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "valid");
  });

  test("an unknown identifier reads NOT FOUND", async ({ page }) => {
    await page.goto("/verify/aaaaaaaaaaaaaaaa");
    await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "not_found");
  });
});

async function storeCertificate(
  request: import("@playwright/test").APIRequestContext,
): Promise<{ id: string; certificate_hash: string; url: string }> {
  const res = await request.post("/api/certificate", { data: draft });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}
