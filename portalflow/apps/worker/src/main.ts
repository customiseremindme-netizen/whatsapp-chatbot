import { Queue, Worker } from "bullmq";
import nodemailer from "nodemailer";
import { createDatabase } from "@portalflow/database";
import {
  drainMessaging,
  MockWhatsAppProvider,
  processScheduledExecutions,
} from "@portalflow/core";
import Redis from "ioredis";
const db = createDatabase();
const events = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
events.on("error", () =>
  console.error(JSON.stringify({ event: "messaging.redis_error" })),
);
const redis = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection = {
  host: redis.hostname,
  port: Number(redis.port || 6379),
  username: redis.username || undefined,
  password: redis.password || undefined,
  ...(redis.protocol === "rediss:" ? { tls: {} } : {}),
};
const smtp = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "localhost",
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure: process.env.SMTP_SECURE === "true",
  ...(process.env.SMTP_USER
    ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }
    : {}),
});
const queue = new Queue("email-outbox", { connection });
const worker = new Worker(
  "email-outbox",
  async () => {
    if (process.env.EMAIL_DELIVERY_ENABLED === "false") return;
    // The transaction lock lets multiple worker processes safely drain the outbox.
    await db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            recipient: string;
            subject: string;
            text: string;
          }>
        >`SELECT id, recipient, subject, text FROM "EmailOutbox" WHERE "sentAt" IS NULL AND attempts < 5 ORDER BY "createdAt" LIMIT 10 FOR UPDATE SKIP LOCKED`;
        for (const row of rows) {
          try {
            await smtp.sendMail({
              from:
                process.env.SMTP_FROM ?? "PortalFlow <hello@portalflow.local>",
              to: row.recipient,
              subject: row.subject,
              text: row.text,
              messageId: `<${row.id}@portalflow.local>`,
            });
            await tx.emailOutbox.update({
              where: { id: row.id },
              data: {
                sentAt: new Date(),
                text: "[delivered]",
                attempts: { increment: 1 },
                lastError: null,
              },
            });
          } catch {
            await tx.emailOutbox.update({
              where: { id: row.id },
              data: {
                attempts: { increment: 1 },
                lastError: "SMTP delivery failed",
              },
            });
            console.error(
              JSON.stringify({ event: "email.delivery_failed", id: row.id }),
            );
          }
        }
      },
      { timeout: 60000 },
    );
  },
  { connection, concurrency: 1 },
);
worker.on("failed", (job) =>
  console.error(JSON.stringify({ event: "email.job_failed", id: job?.id })),
);
worker.on("error", () =>
  console.error(JSON.stringify({ event: "email.worker_error" })),
);
void queue.upsertJobScheduler(
  "drain-email-outbox",
  { every: 5000 },
  { name: "drain", data: {}, opts: { removeOnComplete: 10, removeOnFail: 20 } },
);
const messagingQueue = new Queue("messaging-outbox", { connection });
const messagingWorker = new Worker(
  "messaging-outbox",
  async () => {
    const scheduled = await processScheduledExecutions(db);
    const changed = [
      ...scheduled,
      ...(await drainMessaging(db, new MockWhatsAppProvider())),
    ];
    for (const event of changed)
      await events.publish("portalflow:inbox", JSON.stringify(event));
  },
  { connection, concurrency: 1 },
);
messagingWorker.on("failed", () =>
  console.error(JSON.stringify({ event: "messaging.job_failed" })),
);
messagingWorker.on("error", () =>
  console.error(JSON.stringify({ event: "messaging.worker_error" })),
);
void messagingQueue.upsertJobScheduler(
  "drain-messaging",
  { every: 1000 },
  {
    name: "drain",
    data: {},
    opts: {
      removeOnComplete: 10,
      removeOnFail: 20,
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
    },
  },
);
async function shutdown() {
  await messagingWorker.close();
  await messagingQueue.close();
  events.disconnect();
  await worker.close();
  await queue.close();
  await smtp.close();
  await db.$disconnect();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
