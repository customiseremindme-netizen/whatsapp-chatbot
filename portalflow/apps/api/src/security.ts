import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
export const opaqueToken = () => randomBytes(32).toString("hex");
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function verifyCsrf(value: unknown, stored: string) {
  if (
    typeof value !== "string" ||
    value.length !== 64 ||
    !timingSafeEqual(Buffer.from(hashToken(value)), Buffer.from(stored))
  )
    throw new ForbiddenException("Invalid CSRF token");
}
export function requireActive(expiresAt: Date, revokedAt: Date | null) {
  if (revokedAt || expiresAt <= new Date())
    throw new UnauthorizedException("Session expired");
}
