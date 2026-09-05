import { expect, test } from "@playwright/test";

test("landing page renders the product name", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Saakshi" })).toBeVisible();
});

test("session page exposes a Start control", async ({ page }) => {
  await page.goto("/session");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
});
