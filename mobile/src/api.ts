import { mobileEnv } from "./env";

export const API_ROOT = `${mobileEnv.EXPO_PUBLIC_API_BASE_URL.replace(/\/$/, "")}/api/${mobileEnv.EXPO_PUBLIC_BACKEND_VERSION}`;

export type HealthResponse = { ok: true; service: "nexo-api" };

export async function fetchApiHealth(): Promise<
  | { ok: true; data: HealthResponse }
  | { ok: false; status: number; message: string }
  | { ok: false; status: 0; message: string }
> {
  const url = `${API_ROOT}/health`;
  try {
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      return { ok: false, status: res.status, message: text.slice(0, 200) || res.statusText };
    }
    if (data && typeof data === "object" && (data as HealthResponse).ok === true) {
      return { ok: true, data: data as HealthResponse };
    }
    return { ok: false, status: res.status, message: "Unexpected health response" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network error";
    return {
      ok: false,
      status: 0,
      message: `${msg} — is the API running? (${url})`
    };
  }
}
