import { z } from "zod";
import { mediaSchema, captionLimit, type MediaMessage } from "./flows";
export const roles = ["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"] as const;
export type Role = (typeof roles)[number];
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(12).max(128);
export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    name: z.string().trim().min(2).max(80),
    workspace: z.string().trim().min(2).max(100),
  })
  .strict();
export const tenantSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Invalid timezone"),
    language: z.enum(["en", "ta", "hi"]),
  })
  .strict();
export const inviteSchema = z
  .object({
    email: emailSchema,
    role: z.enum(["ADMIN", "MANAGER", "AGENT", "VIEWER"]),
  })
  .strict();
export const tokenSchema = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const resetSchema = tokenSchema.extend({ password: passwordSchema });
export const brand = {
  name: "PortalFlow",
  primary: "#2563EB",
  secondary: "#0F172A",
  accent: "#22C55E",
};
export function canManage(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}
export function canChangeMember(actor: Role, target: Role): boolean {
  return (
    target !== "OWNER" &&
    (actor === "OWNER" || (actor === "ADMIN" && target !== "ADMIN"))
  );
}
export interface Identity {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerifiedAt: string | null;
    platformAdmin: boolean;
  };
  tenant: {
    id: string;
    name: string;
    timezone: string;
    language: string;
    currency: string;
  };
  role: Role;
  sessionId: string;
}
export interface Workspace {
  id: string;
  name: string;
  role: Role;
}
export interface Member {
  id: string;
  role: Role;
  user: { id: string; name: string; email: string };
}

export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format, for example +919876543210");
export const contactSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    phone: phoneSchema,
    email: emailSchema.optional(),
    company: z.string().trim().max(100).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    notes: z.string().max(4000).default(""),
  })
  .strict();
export const interactiveSchema = z
  .object({
    kind: z.enum(["buttons", "list"]),
    options: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
            title: z.string().min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict()
  .refine((v) => v.kind !== "buttons" || v.options.length <= 3);
export type InteractiveMessage = z.infer<typeof interactiveSchema>;
export const replySchema = z
  .object({
    messageId: z.string().uuid(),
    optionId: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
  })
  .strict();
export type InteractiveReply = z.infer<typeof replySchema>;
/** Text is optional only when media is attached; media captions follow WhatsApp's 1024 limit. */
function textOrMedia(v: { text: string; media?: MediaMessage }) {
  return v.media ? v.text.length <= captionLimit : v.text.length > 0;
}
const textOrMediaIssue = {
  message: `Enter a message, or attach media with a caption of up to ${captionLimit} characters`,
  path: ["text"],
};
export const incomingSchema = z
  .object({
    externalId: z.string().uuid(),
    reply: replySchema.optional(),
    phone: phoneSchema,
    text: z.string().trim().max(4096).default(""),
    media: mediaSchema.optional(),
  })
  .strict()
  .refine(textOrMedia, textOrMediaIssue);
export const messageSchema = z
  .object({
    text: z.string().trim().max(4096).default(""),
    media: mediaSchema.optional(),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
  .refine(textOrMedia, textOrMediaIssue);
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(100).default(""),
});
export interface ContactRecord {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  company: string | null;
  tags: string[];
  notes: string;
  optedInAt: string | null;
  optedOutAt: string | null;
  createdAt: string;
}
export interface MessageRecord {
  idempotencyKey: string;
  interactive: InteractiveMessage | null;
  reply: InteractiveReply | null;
  media: MediaMessage | null;
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  text: string;
  createdAt: string;
  error: string | null;
}
export interface ConversationRecord {
  id: string;
  status: "OPEN" | "CLOSED";
  humanTakeover: boolean;
  unread: boolean;
  lastInboundAt: string | null;
  contact: ContactRecord;
  assignedUserId: string | null;
  messages: MessageRecord[];
}
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export * from "./flows";
export * from "./admin";
