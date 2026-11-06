import { test, expect } from "@playwright/test";
import { makeNode } from "../../packages/shared/src";
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
test("visually edit and publish a chatbot, simulate answers, capture a lead and open the inbox", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Flow Owner");
  await page.getByLabel("Business name").fill("Flow Browser Workspace");
  await page
    .getByLabel("Email address")
    .fill(`flow-browser-${Date.now()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("FlowBrowserPassword!2026");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Flow." }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Chatbot Builder", exact: true })
    .click();
  await page.getByLabel("New flow name").fill("Visual quotation flow");
  await page.getByRole("button", { name: "Create flow", exact: true }).click();
  await expect(page.getByLabel("Flow name")).toHaveValue(
    "Visual quotation flow",
  );
  await page.locator('.react-flow__node[data-id="welcome"]').click();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Welcome from the visual builder!");
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.locator('.react-flow__node[data-id="name"]').click();
  await page.getByLabel("Answer timeout (seconds)").fill("120");
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Published version 1");
  await page.getByRole("button", { name: "Test", exact: true }).click();
  const simulator = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Live engine simulator",
      exact: true,
    }),
  });
  async function reply(text: string) {
    await simulator.getByLabel("Simulated customer message").fill(text);
    await simulator.getByRole("button", { name: "Send test" }).click();
  }
  await reply("Hi");
  await expect(
    simulator.getByText("Welcome from the visual builder!", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    simulator.getByText("What is your name?", { exact: false }),
  ).toBeVisible();
  await expect(
    simulator.getByText("Answer deadline:", { exact: false }),
  ).toBeVisible();
  await reply("Ananya");
  await expect(
    simulator.getByText("What do you need?", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await reply("Printed cartons");
  await expect(
    simulator.getByText("What quantity do you need?", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await reply("125");
  await expect(
    simulator.getByText("Execution: COMPLETED", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    simulator.getByText(
      "Thanks Ananya. Your request for 125 × Printed cartons has been recorded.",
      { exact: false },
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "Leads", exact: true }).click();
  await expect(page.getByRole("cell", { name: /^Ananya/ })).toBeVisible();
  await expect(
    page.getByText("Printed cartons", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Lead stage for Ananya").selectOption("QUALIFIED");
  await expect(page.getByLabel("Lead stage for Ananya")).toHaveValue(
    "QUALIFIED",
  );
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  await page.getByRole("button", { name: /^Ananya/ }).click();
  await expect(
    page
      .getByText(
        "Thanks Ananya. Your request for 125 × Printed cartons has been recorded.",
        { exact: true },
      )
      .last(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Take over", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Release takeover" }),
  ).toBeVisible();
});

test("edits a delay and observes scheduled resume without another customer message", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Timer Owner");
  await page.getByLabel("Business name").fill("Timer Browser Workspace");
  await page
    .getByLabel("Email address")
    .fill(`timer-browser-${Date.now()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("TimerBrowserPassword!2026");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Chatbot Builder", exact: true })
    .click();
  await page.getByLabel("New flow name").fill("Scheduled follow-up");
  await page.getByRole("button", { name: "Create flow", exact: true }).click();
  const graph = {
    schemaVersion: 1,
    nodes: [
      makeNode("start", "start", 0, 0),
      makeNode("delay", "delay", 0, 120, { delaySeconds: 60 }),
      makeNode("reply", "text", 0, 240, { text: "Your scheduled follow-up" }),
      makeNode("end", "end", 0, 360),
    ],
    edges: [
      { id: "1", source: "start", target: "delay" },
      { id: "2", source: "delay", target: "reply" },
      { id: "3", source: "reply", target: "end" },
    ],
  };
  await page.locator('input[type="file"]').setInputFiles({
    name: "timer.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(graph)),
  });
  await page.locator('.react-flow__node[data-id="delay"]').click();
  await page.getByLabel("Delay (seconds)").fill("5");
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Published version 1");
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await page.getByLabel("Simulated customer message").fill("Hi");
  await page.getByRole("button", { name: "Send test" }).click();
  await expect(
    page.getByText("Scheduled resume:", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByText("Execution: COMPLETED", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Live engine simulator",
          exact: true,
        }),
      })
      .getByText("Your scheduled follow-up", { exact: false }),
  ).toBeVisible();
});

test("edits interactive options and follows a clicked simulator branch", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Menu Owner");
  await page.getByLabel("Business name").fill("Menu Browser Workspace");
  await page
    .getByLabel("Email address")
    .fill(`menu-browser-${Date.now()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("MenuBrowserPassword!2026");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Chatbot Builder", exact: true })
    .click();
  await page.getByLabel("New flow name").fill("Interactive routing");
  await page.getByRole("button", { name: "Create flow", exact: true }).click();
  const graph = {
    schemaVersion: 1,
    nodes: [
      makeNode("start", "start", 0, 0),
      makeNode("menu", "buttons", 0, 120, {
        text: "How can we help?",
        variable: "route",
        options: [
          { id: "quote", title: "Quote" },
          { id: "support", title: "Support" },
        ],
      }),
      makeNode("reply", "text", 0, 240, { text: "Selected {{route}}" }),
      makeNode("end", "end", 0, 360),
      makeNode("handoff", "handoff", 280, 240),
    ],
    edges: [
      { id: "1", source: "start", target: "menu" },
      {
        id: "2",
        source: "menu",
        target: "reply",
        sourceHandle: "option:quote",
      },
      {
        id: "3",
        source: "menu",
        target: "handoff",
        sourceHandle: "option:support",
      },
      { id: "4", source: "reply", target: "end" },
    ],
  };
  await page.locator('input[type="file"]').setInputFiles({
    name: "menu.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(graph)),
  });
  await page.locator('.react-flow__node[data-id="menu"]').click();
  await page.getByLabel("Option 1 title").fill("Get quotation");
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Published version 1");
  await page.getByRole("button", { name: "Test", exact: true }).click();
  const simulator = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Live engine simulator",
      exact: true,
    }),
  });
  await simulator.getByLabel("Simulated customer message").fill("Hi");
  await simulator.getByRole("button", { name: "Send test" }).click();
  await expect(
    simulator.getByRole("button", { name: "Get quotation", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await simulator
    .getByRole("button", { name: "Get quotation", exact: true })
    .click();
  await expect(
    simulator.getByText("Execution: COMPLETED", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    simulator.getByText("Selected quote", { exact: false }),
  ).toBeVisible();
});
test("edits a document node behind a keyword match and sees it in the simulator", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Media Owner");
  await page.getByLabel("Business name").fill("Media Browser Workspace");
  await page
    .getByLabel("Email address")
    .fill(`media-browser-${Date.now()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("MediaBrowserPassword!2026");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Chatbot Builder", exact: true })
    .click();
  await page.getByLabel("New flow name").fill("Price list sender");
  await page.getByRole("button", { name: "Create flow", exact: true }).click();
  const graph = {
    schemaVersion: 1,
    nodes: [
      makeNode("start", "start", 0, 0),
      makeNode("match", "keyword_match", 0, 120, { value: "price" }),
      makeNode("doc", "send_document", 0, 240, {
        mediaUrl: "https://files.example.com/list.pdf",
      }),
      makeNode("end", "end", 0, 360),
      makeNode("other", "end", 280, 240),
    ],
    edges: [
      { id: "1", source: "start", target: "match" },
      { id: "2", source: "match", target: "doc", sourceHandle: "true" },
      { id: "3", source: "match", target: "other", sourceHandle: "false" },
      { id: "4", source: "doc", target: "end" },
    ],
  };
  await page.locator('input[type="file"]').setInputFiles({
    name: "media.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(graph)),
  });
  await page.locator('.react-flow__node[data-id="doc"]').click();
  await page
    .getByLabel("Media link (https)")
    .fill("http://insecure.example.com/list.pdf");
  await expect(
    page.getByText("doc: use a public https:// media link"),
  ).toBeVisible();
  await page
    .getByLabel("Media link (https)")
    .fill("https://files.example.com/list.pdf");
  await page.getByLabel("File name shown").fill("Price list.pdf");
  await page.getByLabel("Caption (optional)").fill("Our latest prices");
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Published version 1");
  await page.getByRole("button", { name: "Test", exact: true }).click();
  const simulator = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Live engine simulator",
      exact: true,
    }),
  });
  await simulator.getByLabel("Simulated customer message").fill("Price please");
  await simulator.getByRole("button", { name: "Send test" }).click();
  await expect(
    simulator.getByText("Execution: COMPLETED", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  const link = simulator.getByRole("link", { name: /Price list\.pdf/ });
  await expect(link).toHaveAttribute(
    "href",
    "https://files.example.com/list.pdf",
  );
  await expect(link).toHaveAttribute("rel", /noreferrer/);
  await expect(simulator.getByText("Our latest prices")).toBeVisible();
});
