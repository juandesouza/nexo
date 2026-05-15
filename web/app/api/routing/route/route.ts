import { NextRequest, NextResponse } from "next/server";

type Wp = { lat: number; lng: number };

type SnapProfile = "none" | "start" | "end" | "both";

const OSRM = "https://router.project-osrm.org";

/** Snap a point onto the nearest drivable segment (helps raw GPS vs road network mismatches). */
async function nearestOnRoad(wp: Wp): Promise<Wp | null> {
  if (!Number.isFinite(wp.lat) || !Number.isFinite(wp.lng)) return null;
  try {
    const url = `${OSRM}/nearest/v1/driving/${wp.lng},${wp.lat}?number=1`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { waypoints?: { location?: [number, number] }[] };
    const loc = data.waypoints?.[0]?.location;
    if (!loc || loc.length < 2) return null;
    const [lng, lat] = loc;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/** Proxy OSRM public demo — returns GeoJSON coordinates as lat,lng for Leaflet. */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { snapEnds, snapProfile: snapProfileRaw } = body as {
    snapEnds?: boolean;
    snapProfile?: SnapProfile;
  };
  const waypoints = (body as { waypoints?: Wp[] })?.waypoints;
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    return NextResponse.json({ error: "At least two waypoints required" }, { status: 400 });
  }

  let snapProfile: SnapProfile =
    snapProfileRaw === "start" || snapProfileRaw === "end" || snapProfileRaw === "both"
      ? snapProfileRaw
      : snapEnds === true
        ? "both"
        : "none";

  async function routeDriving(wps: Wp[]): Promise<NextResponse | null> {
    const coordStr = wps.map((p) => `${p.lng},${p.lat}`).join(";");
    const url = `${OSRM}/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      routes?: { distance?: number; duration?: number; geometry?: { coordinates?: [number, number][] } }[];
    };
    const route = data.routes?.[0];
    if (!route?.geometry?.coordinates?.length) return null;

    const latLng = route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
    return NextResponse.json({
      coordinates: latLng,
      distanceMeters: route.distance ?? 0,
      durationSeconds: route.duration ?? 0
    });
  }

  let routed = [...waypoints];
  if (snapProfile === "start" || snapProfile === "both") {
    const a = await nearestOnRoad(routed[0]);
    if (a) routed[0] = a;
  }
  if (snapProfile === "end" || snapProfile === "both") {
    const last = routed.length - 1;
    if (last >= 1) {
      const b = await nearestOnRoad(routed[last]);
      if (b) routed[last] = b;
    }
  }

  try {
    let json = await routeDriving(routed);
    if (!json && snapProfile !== "none") {
      json = await routeDriving([...waypoints]);
    }
    if (json) return json;
    return NextResponse.json({ error: "No route" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Routing failed" }, { status: 502 });
  }
}
