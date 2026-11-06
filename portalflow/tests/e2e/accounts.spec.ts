import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("register, update workspace, create and switch workspace, log out and back in", async ({
  page,
}) => {
  const email = `browser-${randomUUID()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Browser Owner");
  await page.getByLabel("Business name").fill("Browser Business");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("BrowserPassword!2026");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Browser." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Workspace name", { exact: true })
    .fill("Updated Business");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Workspace updated.");
  await page.getByLabel("New workspace name").fill("Second Workspace");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Workspace created.");
  await page
    .getByLabel("Workspace", { exact: true })
    .selectOption({ label: "Second Workspace" });
  await expect(page.getByLabel("Workspace name", { exact: true })).toHaveValue(
    "Second Workspace",
  );
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: email, exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send invitation" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/login/);
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("BrowserPassword!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Browser." }),
  ).toBeVisible();
});
test("mobile navigation stays usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@lotus.example");
  await page
    .getByLabel("Password", { exact: true })
    .fill("LocalPortalFlow!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Priya." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your team" })).toBeVisible();
});
