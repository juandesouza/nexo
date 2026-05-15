import { z } from "zod";

/**
 * Local dev uses `http://localhost` or LAN IP (Android emulator: `http://10.0.2.2:PORT`).
 * Production builds should use HTTPS.
 */
const schema = z.object({
  EXPO_PUBLIC_API_BASE_URL: z.string().url(),
  EXPO_PUBLIC_BACKEND_VERSION: z.string().min(1),
  /** Optional; defaults to API host (same as web). */
  EXPO_PUBLIC_WS_URL: z.string().url().optional(),
  /** Reserved for native Google Sign-In (not required for API smoke test). */
  EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID: z.string().optional(),
  EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID: z.string().optional()
});

const defaults = {
  EXPO_PUBLIC_API_BASE_URL: "http://localhost:4000",
  EXPO_PUBLIC_BACKEND_VERSION: "v1"
} as const;

export const mobileEnv = schema.parse({
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL ?? defaults.EXPO_PUBLIC_API_BASE_URL,
  EXPO_PUBLIC_BACKEND_VERSION: process.env.EXPO_PUBLIC_BACKEND_VERSION ?? defaults.EXPO_PUBLIC_BACKEND_VERSION,
  EXPO_PUBLIC_WS_URL: process.env.EXPO_PUBLIC_WS_URL,
  EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID
});

export const mobileWsOrigin =
  mobileEnv.EXPO_PUBLIC_WS_URL?.replace(/\/$/, "") ??
  mobileEnv.EXPO_PUBLIC_API_BASE_URL.replace(/\/$/, "");
