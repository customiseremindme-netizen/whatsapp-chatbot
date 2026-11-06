import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  /** Optional extra exact browser origins (comma separated), e.g. a www alias or preview host. */
  WEB_ORIGIN_ALLOWLIST: z.string().default(""),
  PORT: z.coerce.number().default(4000),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
});
export const config = schema.parse(process.env);
function origin(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== value)
    throw new Error(`Invalid origin in WEB_ORIGIN_ALLOWLIST: ${value}`);
  return url.origin;
}
/** Exact origins allowed for CORS, CSRF Origin checks and WebSocket handshakes. */
export const allowedOrigins = [
  new URL(config.WEB_ORIGIN).origin,
  ...config.WEB_ORIGIN_ALLOWLIST.split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map(origin),
];
export const originAllowed = (value: unknown) =>
  typeof value === "string" && allowedOrigins.includes(value);
if (
  config.NODE_ENV === "production" &&
  (config.COOKIE_SECURE !== "true" ||
    allowedOrigins.some((o) => !o.startsWith("https://")))
)
  throw new Error("Production requires secure cookies and HTTPS");
