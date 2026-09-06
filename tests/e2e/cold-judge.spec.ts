import { expect, test, type Page } from "@playwright/test";

// A judge who reads nothing. Run against a production build, because that is what they will open:
//   pnpm build && pnpm start
//   PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test tests/e2e/cold-judge.spec.ts
//
// It cannot tell whether the page is obvious. It can tell whether anything is broken on the way:
// console errors, failed requests, a page that scrolls sideways on a projector, a primary action
// that the keyboard cannot reach, and a dead end with no way back.

const PROJECTOR = { width: 1280, height: 720 };
const LAPTOP = { width: 1440, height: 900 };

type Problem = { where: string; what: string };

function watch(page: Page, problems: Problem[], where: string) {
  page.on("console", (m) => {
    if (m.type() === "error") problems.push({ where, what: `console: ${m.text().slice(0, 200)}` });
  });
  page.on("pageerror", (e) =>
    problems.push({ where, what: `pageerror: ${e.message.slice(0, 200)}` }),
  );
  page.on("requestfailed", (r) => {
    const url = r.url();
    // A websocket without a token is expected on a page that has not started a session.
    if (url.startsWith("ws")) return;
    problems.push({
      where,
      what: `request failed: ${url.slice(0, 120)} ${r.failure()?.errorText}`,
    });
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/api/token/")) {
      problems.push({ where, what: `${r.status()} from ${r.url().slice(0, 120)}` });
    }
  });
}

async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

test.describe("a judge who reads nothing", () => {
  test("can walk the whole product without hitting a broken page", async ({ page }) => {
    const problems: Problem[] = [];

    await page.setViewportSize(LAPTOP);
    watch(page, problems, "landing");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // The one thing they must find without help.
    const open = page.getByRole("link", { name: /Open the room/i }).first();
    await expect(open).toBeVisible();

    // Reachable by keyboard, for anyone not using a mouse.
    await page.keyboard.press("Tab");
    const reached = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return active
        ? active.tagName + ":" + (active.textContent ?? "").trim().slice(0, 40)
        : "none";
    });
    expect(reached, "the first tab stop should be a real control").not.toBe("none");

    for (const [name, size] of [
      ["laptop", LAPTOP],
      ["projector", PROJECTOR],
    ] as const) {
      await page.setViewportSize(size);
      for (const path of ["/", "/metrics"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        expect(await scrollsSideways(page), `${path} scrolls sideways on a ${name}`).toBe(false);
      }
    }

    // Back to where a judge actually starts, after the responsive sweep moved us.
    await page.setViewportSize(LAPTOP);
    await page.goto("/");
    await page
      .getByRole("link", { name: /Open the room/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/session$/);

    // The start screen has to explain itself: judge-solo on, and what is about to be tracked.
    await expect(page.getByTestId("judge-solo-toggle")).toBeChecked();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
    await expect(
      page
        .getByTestId("checkpoint")
        .first()
        .or(page.getByText(/tracks/i)),
    ).toBeVisible();

    if (problems.length > 0) {
      console.log(
        "\n[cold-judge] problems:\n" + problems.map((p) => `  ${p.where}: ${p.what}`).join("\n"),
      );
    }
    expect(problems, "a judge should hit no console or network errors").toEqual([]);
  });

  test("is told what to do when a certificate identifier is wrong", async ({ page }) => {
    await page.goto("/verify/doesnotexist12345");
    await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "not_found");
    // A dead end is only acceptable if it says how to leave it.
    await expect(page.getByRole("link", { name: /What is Saakshi/i })).toBeVisible();
  });

  test("finds the metrics page from the landing page, both top and bottom", async ({ page }) => {
    await page.goto("/");
    const links = page.getByRole("link", { name: /How well it works/i });
    await expect(links).toHaveCount(2);
    await links.first().click();
    await expect(page).toHaveURL(/\/metrics$/);
  });
});
