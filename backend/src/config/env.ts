import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
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
    /** Comma-separated list of allowed browser origins (required in production). */
    CORS_ORIGINS: z.string().optional(),
    GOOGLE_OAUTH_WEB_CLIENT_ID: z.string().min(1),
    GOOGLE_OAUTH_MOBILE_CLIENT_ID: z.string().min(1),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
    BRAINTREE_ENVIRONMENT: z.enum(["sandbox", "production"]).optional(),
    BRAINTREE_MERCHANT_ID: z.string().optional(),
    BRAINTREE_PUBLIC_KEY: z.string().optional(),
    BRAINTREE_PRIVATE_KEY: z.string().optional(),
    YAMMA_DISPATCH_TOKEN: z.string().optional(),
    YAMMA_WEBHOOK_URL: z.string().url().optional(),
    YAMMA_WEBHOOK_SECRET: z.string().optional()
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === "production") {
      if (!data.CORS_ORIGINS?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CORS_ORIGINS"],
          message: "CORS_ORIGINS is required in production (comma-separated HTTPS web origins)"
        });
      }
      if (data.PUBLIC_RESET_URL.includes("localhost") || data.PUBLIC_RESET_URL.includes("127.0.0.1")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["PUBLIC_RESET_URL"],
          message: "PUBLIC_RESET_URL must be a public HTTPS URL in production"
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid backend env: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function parseCorsOrigins(corsOrigins: string | undefined): string[] | true {
  if (!corsOrigins?.trim()) {
    return true;
  }
  return corsOrigins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}
