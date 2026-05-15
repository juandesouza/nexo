import type { AuthResponse, AuthRole } from "./api";

export const STORAGE_LOCATION_GATE_OK = "nexo_location_gate_ok";
export const STORAGE_TOKEN = "nexo_access_token";

export const STORAGE_USER = "nexo_user";
export const STORAGE_GUEST_PASSENGER_ID = "nexo_guest_passenger_id";
export const STORAGE_GUEST_DRIVER_ID = "nexo_guest_driver_id";
export const STORAGE_RIDE_HISTORY = "nexo_ride_history";

export type SessionUser = {
  id: string;
  email: string;
  role: AuthRole;
  provider: "email" | "google";
};

export type RideHistoryEntry = {
  id: string;
  summary: string;
  createdAt: string;
};

export function readLocationGateSatisfied(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(STORAGE_LOCATION_GATE_OK) === "1";
  } catch {
    return false;
  }
}

export function persistLocationGateOk(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_LOCATION_GATE_OK, "1");
  } catch {
    //
  }
}

export function clearLocationGateOk(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_LOCATION_GATE_OK);
  } catch {
    //
  }
}

export function persistAuth(response: AuthResponse) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_TOKEN, response.accessToken);
  localStorage.setItem(STORAGE_USER, JSON.stringify(response.user));
}

export function persistUser(user: SessionUser) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_USER, JSON.stringify(user));
}

/** Clears credentials and guest id only (keeps local ride history). */
export function clearAuthSession() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_USER);
  localStorage.removeItem(STORAGE_GUEST_PASSENGER_ID);
  localStorage.removeItem(STORAGE_GUEST_DRIVER_ID);
}

/** Full local reset: auth, guest id, and ride history (logout / deleted account). */
export function logoutLocal() {
  if (typeof localStorage === "undefined") return;
  clearAuthSession();
  clearLocationGateOk();
  localStorage.removeItem(STORAGE_RIDE_HISTORY);
}

export function loadStoredToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(STORAGE_TOKEN);
}

export function loadStoredUser(): SessionUser | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_USER);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionUser;
    if (parsed?.id && parsed?.email && parsed?.role && parsed?.provider) {
      return parsed;
    }
  } catch {
    //
  }
  return null;
}

export function getOrCreateGuestPassengerId(): string {
  if (typeof localStorage === "undefined") {
    throw new Error("Guest passenger id unavailable without localStorage.");
  }
  let id = localStorage.getItem(STORAGE_GUEST_PASSENGER_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_GUEST_PASSENGER_ID, id);
  }
  return id;
}

export function getOrCreateGuestDriverId(): string {
  if (typeof localStorage === "undefined") {
    throw new Error("Guest driver id unavailable without localStorage.");
  }
  let id = localStorage.getItem(STORAGE_GUEST_DRIVER_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_GUEST_DRIVER_ID, id);
  }
  return id;
}

export function loadRideHistory(): RideHistoryEntry[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_RIDE_HISTORY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as RideHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendRideHistory(entry: Omit<RideHistoryEntry, "createdAt">) {
  if (typeof localStorage === "undefined") return;
  const next: RideHistoryEntry = { ...entry, createdAt: new Date().toISOString() };
  const prev = loadRideHistory();
  localStorage.setItem(STORAGE_RIDE_HISTORY, JSON.stringify([next, ...prev].slice(0, 50)));
}
