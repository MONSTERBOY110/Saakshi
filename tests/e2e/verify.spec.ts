import { expect, test } from "@playwright/test";
import { storeCertificate } from "./fixtures/certificate";

// The public verification page (P0-9, FR-10). No AssemblyAI needed: the certificate is posted to
// the API, then the page recomputes both proofs from the stored payload.

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
