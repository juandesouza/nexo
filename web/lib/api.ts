import { webEnv } from "./env";

const API_ROOT = `${webEnv.NEXT_PUBLIC_API_BASE_URL}/api/${webEnv.NEXT_PUBLIC_BACKEND_VERSION}`;

export type RidePayload = {
  passengerId: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  /** Address label chosen from search (shown to drivers). */
  dropoffLabel?: string;
  /** Optional; fares are finalized when a driver accepts with GPS-based routing from their app. */
  routedDistanceKm?: number;
  distanceToPickupKm?: number;
};

export type AcceptRideOptions = {
  driverName?: string;
  routedDistanceKm?: number;
  distanceToPickupKm?: number;
  driverLat?: number;
  driverLng?: number;
};

export type SetupPaymentMethodPayload = {
  passengerId: string;
  paymentMethodNonce: string;
  email?: string;
};
export type SetupDriverPayoutPayload = {
  driverId: string;
  accountHolder: string;
  payoutDestination: string;
};

export type DeliveryPayload = {
  orderId: string;
  restaurantLat: number;
  restaurantLng: number;
  customerLat: number;
  customerLng: number;
};

export type AcceptDeliveryPayload = {
  driverId: string;
};

export type UpdateDeliveryStatusPayload = {
  driverId: string;
  status: "going_to_restaurant" | "picked_up" | "delivering" | "delivered" | "canceled";
};

export type AuthRole = "passenger" | "driver";

export type AuthResponse = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: AuthRole;
    provider: "email" | "google";
  };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  const body = (await response.json().catch(() => null)) as T | { message?: string } | null;
  if (!response.ok) {
    const message =
      (body && typeof body === "object" && "message" in body && body.message) ||
      `Request failed with status ${response.status}`;
    throw new Error(String(message));
  }

  return body as T;
}

async function authRequest<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${accessToken}`
    }
  });
}

export async function fetchAuthProfile(accessToken: string) {
  return authRequest<AuthResponse["user"]>(accessToken, "/auth/me", { method: "GET" });
}

export async function deleteAccountApi(accessToken: string) {
  return authRequest<{ ok: boolean }>(accessToken, "/auth/account", { method: "DELETE" });
}

export async function createRide(payload: RidePayload) {
  return request("/rides", { method: "POST", body: JSON.stringify(payload) });
}

export async function acceptRide(
  rideId: string,
  driverId: string,
  options?: AcceptRideOptions
) {
  return request(`/rides/${rideId}/accept`, {
    method: "POST",
    body: JSON.stringify({
      driverId,
      ...(options?.driverName ? { driverName: options.driverName } : {}),
      ...(options?.routedDistanceKm != null ? { routedDistanceKm: options.routedDistanceKm } : {}),
      ...(options?.distanceToPickupKm != null ? { distanceToPickupKm: options.distanceToPickupKm } : {}),
      ...(options?.driverLat != null ? { driverLat: options.driverLat } : {}),
      ...(options?.driverLng != null ? { driverLng: options.driverLng } : {})
    })
  });
}

export async function getRide(id: string) {
  return request(`/rides/${id}`, { method: "GET" });
}

export async function cancelRide(rideId: string) {
  return request(`/rides/${rideId}/cancel`, { method: "POST" });
}

export async function completeRide(rideId: string) {
  return request(`/rides/${rideId}/complete`, { method: "POST" });
}

export async function getPaymentMethodStatus(passengerId: string) {
  return request<{ configured: boolean }>(`/payments/method/${passengerId}`, { method: "GET" });
}

export async function setupPaymentMethod(payload: SetupPaymentMethodPayload) {
  return request("/payments/method", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getDriverPayoutStatus(driverId: string) {
  return request<{ configured: boolean }>(`/payments/payout/${driverId}`, { method: "GET" });
}

export async function setupDriverPayout(payload: SetupDriverPayoutPayload) {
  return request("/payments/payout", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function createDelivery(payload: DeliveryPayload) {
  return request("/deliveries", { method: "POST", body: JSON.stringify(payload) });
}

export async function createYammaDelivery(payload: DeliveryPayload) {
  return request("/integrations/yamma/orders-created", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function acceptDelivery(deliveryId: string, payload: AcceptDeliveryPayload) {
  return request(`/deliveries/${deliveryId}/accept`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateDeliveryStatus(deliveryId: string, payload: UpdateDeliveryStatusPayload) {
  return request(`/deliveries/${deliveryId}/status`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function signUpWithEmail(payload: {
  email: string;
  password: string;
  role: AuthRole;
}) {
  return request<AuthResponse>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function loginWithEmail(payload: { email: string; password: string }) {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function loginWithGoogle(payload: { token: string; role?: AuthRole }) {
  return request<AuthResponse>("/auth/google", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
