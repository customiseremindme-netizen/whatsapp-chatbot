import { test, expect } from "@playwright/test";

test("platform administrator edits plan catalogue and visible branding without code", async ({
  page,
}) => {
  test.setTimeout(60000);
  const original = await (
    await page.request.get("/api/v1/configuration")
  ).json();
  await page.goto("/login");
  await page.getByLabel("Email address").fill("admin@portalflow.example");
  await page
    .getByLabel("Password", { exact: true })
    .fill("LocalPortalFlow!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard", { timeout: 20000 });
  await page.getByRole("link", { name: "Platform admin", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Administration", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Plans", exact: true }).click();
  const name = `Browser plan ${Date.now()}`;
  const create = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Add a plan", exact: true }),
  });
  await create.getByLabel("Plan name", { exact: true }).fill(name);
  await create.getByLabel("Monthly price (INR)").fill("1234.56");
  await create
    .getByRole("button", { name: "Create plan", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Plan created.");
  const saved = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(saved.getByLabel("Monthly price (INR)")).toHaveValue("1234.56");
  await saved.getByLabel("Monthly price (INR)").fill("2499.99");
  await saved.getByLabel("Archived", { exact: true }).check();
  await saved.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Plan saved.");
  await page.reload();
  await page.getByRole("button", { name: "Plans", exact: true }).click();
  await expect(saved.getByLabel("Monthly price (INR)")).toHaveValue("2499.99");
  await expect(saved.getByLabel("Archived", { exact: true })).toBeChecked();
  try {
    await page
      .getByRole("button", { name: "Configuration", exact: true })
      .click();
    await page
      .getByLabel("Product name", { exact: true })
      .fill("PortalFlow Admin Test");
    await page
      .getByRole("button", { name: "Save configuration", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      "Brand configuration saved.",
    );
    await expect(
      page.getByRole("link", { name: "PortalFlow Admin Test", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Audit logs", exact: true }).click();
    await page.getByLabel("Search audit logs").fill("configuration.updated");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      page
        .getByRole("heading", { name: "configuration.updated", exact: true })
        .first(),
    ).toBeVisible();
  } finally {
    const current = await (
      await page.request.get("/api/v1/configuration")
    ).json();
    const csrf = (await page.context().cookies()).find(
      (c) => c.name === "pf_csrf",
    )!.value;
    const restored = await page.request.patch("/api/v1/admin/configuration", {
      headers: { Origin: "http://localhost:3000", "X-CSRF-Token": csrf },
      data: { ...original, revision: current.revision },
    });
    expect(restored.status()).toBe(200);
  }
});

test("ordinary business owner cannot use the platform admin page", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@lotus.example");
  await page
    .getByLabel("Password", { exact: true })
    .fill("LocalPortalFlow!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard", { timeout: 20000 });
  await expect(
    page.getByRole("link", { name: "Platform admin", exact: true }),
  ).toHaveCount(0);
  await page.goto("/admin");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Platform administrator access is required" }),
  ).toContainText("Platform administrator access is required");
});

test("admin assigns a manual plan and owner sees an enforced contact limit", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const stamp = Date.now(),
    business = `Quota browser ${stamp}`,
    plan = `One contact ${stamp}`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Capacity Owner");
  await page.getByLabel("Business name").fill(business);
  await page
    .getByLabel("Email address")
    .fill(`quota-browser-${stamp}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("CapacityBrowser!2026");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await page.waitForURL("**/dashboard", { timeout: 20000 });
  const context = await browser.newContext(),
    operator = await context.newPage();
  try {
    await operator.goto("http://localhost:3000/login");
    await operator.getByLabel("Email address").fill("admin@portalflow.example");
    await operator
      .getByLabel("Password", { exact: true })
      .fill("LocalPortalFlow!2026");
    await operator
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await operator.waitForURL("**/dashboard", { timeout: 20000 });
    await operator
      .getByRole("link", { name: "Platform admin", exact: true })
      .click();
    await operator.getByRole("button", { name: "Plans", exact: true }).click();
    const form = operator
      .locator("section")
      .filter({
        has: operator.getByRole("heading", { name: "Add a plan", exact: true }),
      });
    await form.getByLabel("Plan name", { exact: true }).fill(plan);
    await form.getByLabel("Contacts", { exact: true }).fill("1");
    await form
      .getByRole("button", { name: "Create plan", exact: true })
      .click();
    await expect(operator.getByRole("status")).toHaveText("Plan created.");
    await operator
      .getByRole("button", { name: "Businesses", exact: true })
      .click();
    await operator.getByLabel("Search businesses").fill(business);
    await operator.getByRole("button", { name: "Search", exact: true }).click();
    const card = operator
      .locator("section")
      .filter({
        has: operator.getByRole("heading", { name: business, exact: true }),
      });
    await card
      .getByRole("button", { name: "Manage plan access", exact: true })
      .click();
    await card
      .getByLabel("Access plan", { exact: true })
      .selectOption({ label: plan });
    await card
      .getByLabel("Assignment reason", { exact: true })
      .fill("Browser verified manual grant");
    await card
      .getByRole("button", { name: "Save access grant", exact: true })
      .click();
    await expect(card.getByRole("status")).toHaveText(
      "Manual access grant saved. No payment collected.",
    );
    await page
      .getByRole("link", { name: "Plan and usage", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: plan, exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Contacts", exact: true }).click();
    for (const [name, phone] of [
      ["Allowed", "+15555550801"],
      ["Blocked", "+15555550802"],
    ]) {
      await page
        .getByRole("button", { name: "Add contact", exact: true })
        .click();
      await page.getByLabel("Name", { exact: true }).fill(name!);
      await page.getByLabel("Phone (E.164)").fill(phone!);
      await page
        .getByRole("button", { name: "Save contact", exact: true })
        .click();
      if (name === "Allowed")
        await expect(
          page.getByRole("cell", { name: `${name} ${phone}` }),
        ).toBeVisible();
    }
    await expect(
      page.getByRole("alert").filter({ hasText: "contacts limit reached" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
