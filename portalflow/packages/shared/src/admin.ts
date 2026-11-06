import { z } from "zod";
export const planSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    monthlyPaise: z.number().int().min(0).max(100000000),
    yearlyPaise: z.number().int().min(0).max(1000000000),
    maxNumbers: z.number().int().min(1).max(1000),
    maxMembers: z.number().int().min(1).max(10000),
    maxContacts: z.number().int().min(1).max(10000000),
    maxBots: z.number().int().min(1).max(10000),
    archived: z.boolean().default(false),
  })
  .strict();
export type PlanValues = z.infer<typeof planSchema>;
export type PlanRecord = PlanValues & {
  id: string;
  currency: string;
  revision: number;
};
export const configurationSchema = z
  .object({
    brandName: z.string().trim().min(1).max(60),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    supportEmail: z.string().trim().email().max(254),
  })
  .strict();
export type PlatformConfiguration = z.infer<typeof configurationSchema> & {
  revision: number;
};
export const defaultConfiguration: PlatformConfiguration = {
  brandName: "PortalFlow",
  primaryColor: "#2563EB",
  supportEmail: "support@example.com",
  revision: 0,
};

export const assignmentSchema = z
  .object({
    planId: z.string().uuid(),
    status: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]),
    expiresAt: z.string().datetime(),
    revision: z.number().int().min(0),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export interface SubscriptionSummary {
  source: "TRIAL" | "MANUAL";
  status: string;
  active: boolean;
  planName: string;
  planId: string | null;
  planRevision: number | null;
  revision: number;
  expiresAt: string;
  limits: { contacts: number; bots: number; members: number; numbers: number };
  usage: {
    contacts: number;
    bots: number;
    members: number;
    invitations: number;
    blockedInbound: number;
  };
}
