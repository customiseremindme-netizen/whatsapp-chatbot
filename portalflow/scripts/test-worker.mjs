import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { createDatabase } from "../packages/database/dist/index.js";
if (process.env.NODE_ENV === "production")
  throw new Error("Development test only");
const db = createDatabase();
const recipient = `worker-${crypto.randomUUID()}@example.com`;
const row = await db.emailOutbox.create({
  data: {
    recipient,
    subject: "Worker delivery integration",
    text: "A real SMTP delivery through the durable outbox.",
  },
});
const worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
  env: process.env,
  stdio: "inherit",
});
try {
  let delivered = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const message = await db.emailOutbox.findUniqueOrThrow({
      where: { id: row.id },
    });
    if (message.sentAt) {
      assert.equal(message.text, "[delivered]");
      delivered = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(delivered, true, "Worker must mark the email delivered");
  const response = await fetch(
    `http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`,
  );
  assert.equal(response.ok, true);
  const captured = await response.json();
  assert.equal(
    captured.messages.length,
    1,
    "Mailpit must receive exactly one test email",
  );
  assert.equal(captured.messages[0].Subject, "Worker delivery integration");
  console.log(
    "PASS: BullMQ worker → PostgreSQL outbox → SMTP → Mailpit; delivered content redacted",
  );
} finally {
  worker.kill("SIGTERM");
  await once(worker, "exit");
  await db.emailOutbox.delete({ where: { id: row.id } });
  await db.$disconnect();
}
