import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url(),
  NEXT_PUBLIC_BACKEND_VERSION: z.string().min(1),
  NEXT_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID: z.string().min(1),
  NEXT_PUBLIC_WS_URL: z.string().url().optional()
});

const defaults = {
  NEXT_PUBLIC_API_BASE_URL: "http://localhost:4000",
  NEXT_PUBLIC_BACKEND_VERSION: "v1",
  NEXT_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID: "local-web-client-id"
} as const;

const parsed = schema.safeParse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? defaults.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_BACKEND_VERSION:
    process.env.NEXT_PUBLIC_BACKEND_VERSION ?? defaults.NEXT_PUBLIC_BACKEND_VERSION,
  NEXT_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID:
    process.env.NEXT_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID ??
    defaults.NEXT_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID,
  NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL
});

if (!parsed.success) {
  throw new Error(
    `Invalid web env configuration. Set NEXT_PUBLIC_API_BASE_URL, NEXT_PUBLIC_BACKEND_VERSION, and NEXT_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID in web/.env.local. Details: ${parsed.error.message}`
  );
}

if (
  !process.env.NEXT_PUBLIC_API_BASE_URL ||
  !process.env.NEXT_PUBLIC_BACKEND_VERSION ||
  !process.env.NEXT_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID
) {
  console.warn(
    "[NEXO/web] Missing NEXT_PUBLIC_* env vars. Using local development defaults from web/lib/env.ts."
  );
}

export const webEnv = {
  ...parsed.data,
  /** Socket.IO origin (same host as API unless overridden). */
  NEXT_PUBLIC_WS_URL: parsed.data.NEXT_PUBLIC_WS_URL ?? parsed.data.NEXT_PUBLIC_API_BASE_URL
};
