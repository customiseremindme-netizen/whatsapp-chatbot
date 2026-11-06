import { test, expect } from "@playwright/test";
import { spawn, ChildProcess } from "node:child_process";
import { once } from "node:events";
let worker: ChildProcess;
test.beforeAll(() => {
  worker = spawn(
    process.execPath,
    ["--env-file=.env", "apps/worker/dist/main.js"],
    {
      env: { ...process.env, EMAIL_DELIVERY_ENABLED: "false" },
      stdio: "ignore",
    },
  );
});
test.afterAll(async () => {
  worker.kill("SIGTERM");
  await once(worker, "exit");
});
test("create a contact, receive a customer message, reply, take over and leave an internal note", async ({
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
    page.getByRole("heading", { name: "Welcome, Priya." }),
  ).toBeVisible();
  const phone = `+91${String(Date.now()).slice(-10)}`;
  const name = `Inbox customer ${Date.now()}`;
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "Add contact" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Phone (E.164)").fill(phone);
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(
    page.getByRole("cell", { name: `${name} ${phone}` }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  await expect(page.getByText(/Live updates connected/)).toBeVisible();
  await page.getByRole("button", { name: "Simulate incoming" }).click();
  await page.getByLabel("Customer phone").fill(phone);
  await page.getByLabel("Customer message").fill("I would like a quotation");
  await page.getByRole("button", { name: "Receive test message" }).click();
  await page
    .getByRole("button", { name: new RegExp(name) })
    .click({ timeout: 20000 });
  await expect(
    page.getByText("I would like a quotation", { exact: true }).last(),
  ).toBeVisible();
  await page
    .getByLabel("Reply message")
    .fill("Our team can help with your quotation.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(
    page
      .getByText("Our team can help with your quotation.", { exact: true })
      .last(),
  ).toBeVisible();
  await expect(page.getByText(/DELIVERED/)).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByRole("button", { name: "Release takeover" }),
  ).toBeVisible();
  await page
    .getByLabel("Internal note")
    .fill("Customer needs a quotation today");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(
    page.getByText("Customer needs a quotation today", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Release takeover" }).click();
  await expect(
    page.getByRole("button", { name: "Take over", exact: true }),
  ).toBeVisible();
});
