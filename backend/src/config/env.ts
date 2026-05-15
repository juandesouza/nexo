import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().default("4000"),
  BACKEND_VERSION: z.string().default("v1"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(24),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.string().regex(/^\d+$/),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  PUBLIC_RESET_URL: z.string().url(),
  GOOGLE_OAUTH_WEB_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_MOBILE_CLIENT_ID: z.string().min(1),
  YAMMA_DISPATCH_TOKEN: z.string().optional(),
  YAMMA_WEBHOOK_URL: z.string().url().optional(),
  YAMMA_WEBHOOK_SECRET: z.string().optional()
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid backend env: ${parsed.error.message}`);
  }

  return parsed.data;
}
