import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  PORT: z.coerce.number().default(4000),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
});
export const config = schema.parse(process.env);
if (
  config.NODE_ENV === "production" &&
  (config.COOKIE_SECURE !== "true" || !config.WEB_ORIGIN.startsWith("https://"))
)
  throw new Error("Production requires secure cookies and HTTPS");
