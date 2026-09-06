import { expect, test } from "@playwright/test";

test("landing page names the product and says what it does", async ({ page }) => {
  await page.goto("/");
  // The wordmark carries the name; the heading carries the promise.
  await expect(page.getByText("SAAKSHI").first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("OUT LOUD");
  await expect(page.getByRole("link", { name: /Open the room/i }).first()).toBeVisible();
});

test("session page exposes a Start control", async ({ page }) => {
  await page.goto("/session");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
});
