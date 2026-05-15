export type LatLng = { lat: number; lng: number };

export type NominatimHit = {
  display_name: string;
  lat: string;
  lon: string;
};

export async function searchAddresses(query: string): Promise<NominatimHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as NominatimHit[]) : [];
}

export type OsrmApiResponse = {
  coordinates: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
};

/** Which endpoints OSRM /nearest snaps onto the road graph before routing. */
export type SnapProfile = "none" | "start" | "end" | "both";

export type FetchRoadRouteOptions = {
  snapProfile?: SnapProfile;
  /** If true, equivalent to snapProfile `"both"`. Ignored when `snapProfile` is set. */
  snapEnds?: boolean;
  attempts?: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchRoadRouteOnce(
  waypoints: LatLng[],
  snapProfile: SnapProfile
): Promise<OsrmApiResponse | null> {
  try {
    const res = await fetch("/api/routing/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waypoints, snapProfile })
    });
    let data: Partial<OsrmApiResponse> & { error?: string };
    try {
      data = (await res.json()) as Partial<OsrmApiResponse> & { error?: string };
    } catch {
      return null;
    }
    if (!res.ok || !Array.isArray(data.coordinates) || data.coordinates.length < 2) {
      return null;
    }
    return {
      coordinates: data.coordinates,
      distanceMeters: data.distanceMeters ?? 0,
      durationSeconds: data.durationSeconds ?? 0
    };
  } catch {
    return null;
  }
}

/** Request a driving route via our OSRM proxy. Never substitutes straight-line geometries. */
export async function fetchRoadRoute(
  waypoints: LatLng[],
  options?: FetchRoadRouteOptions
): Promise<OsrmApiResponse | null> {
  if (waypoints.length < 2) return null;
  const profile: SnapProfile =
    options?.snapProfile ?? (options?.snapEnds === true ? "both" : "none");
  const tries = Math.max(1, Math.min(5, options?.attempts ?? 3));
  for (let i = 0; i < tries; i++) {
    let parsed = await fetchRoadRouteOnce(waypoints, profile);
    if (!parsed && profile !== "none") {
      parsed = await fetchRoadRouteOnce(waypoints, "none");
    }
    if (parsed?.coordinates?.length && parsed.coordinates.length >= 2) {
      return parsed;
    }
    if (i + 1 < tries) await delay(450 * (i + 1));
  }
  return null;
}

/** Concatenate two OSRM legs; drops duplicate join point. */
export function appendRouteLegs(a: [number, number][], b: [number, number][]): [number, number][] {
  if (a.length === 0) return [...b];
  if (b.length === 0) return [...a];
  const last = a[a.length - 1];
  const first = b[0];
  const dup =
    Math.abs(last[0] - first[0]) < 1e-6 && Math.abs(last[1] - first[1]) < 1e-6;
  return dup ? [...a, ...b.slice(1)] : [...a, ...b];
}
