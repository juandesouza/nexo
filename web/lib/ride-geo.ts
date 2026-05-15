/** Linear interpolation along a polyline; `t` in [0, 1]. */
export function interpolateAlongPath(points: readonly [number, number][], t: number): [number, number] {
  if (points.length === 0) {
    return [0, 0];
  }
  if (points.length === 1) {
    return [points[0][0], points[0][1]];
  }
  const clamped = Math.min(1, Math.max(0, t));
  const totalSegments = points.length - 1;
  const f = clamped * totalSegments;
  const i = Math.min(Math.floor(f), totalSegments - 1);
  const localT = f - i;
  const [a0, a1] = points[i];
  const [b0, b1] = points[i + 1];
  return [a0 + (b0 - a0) * localT, a1 + (b1 - a1) * localT];
}

/** Synthetic driver starting position near pickup (demo — replace with live GPS later). */
export function syntheticDriverStartNearPickup(pickup: { lat: number; lng: number }): [number, number] {
  return [pickup.lat + 0.02, pickup.lng - 0.015];
}

/** Compass bearing in degrees (0 = north) from `from` to `to`, for rotating a vehicle marker. */
export function bearingDegrees(from: readonly [number, number], to: readonly [number, number]): number {
  const φ1 = (from[0] * Math.PI) / 180;
  const φ2 = (to[0] * Math.PI) / 180;
  const Δλ = ((to[1] - from[1]) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

/** Distance in kilometers using the Haversine formula. */
export function haversineKm(a: readonly [number, number], b: readonly [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** ETA seconds for a given distance and speed. */
export function etaSeconds(distanceKm: number, speedKmh: number): number {
  const safeSpeed = Math.max(8, speedKmh);
  return Math.max(10, Math.round((distanceKm / safeSpeed) * 3600));
}

/** Total polyline length in km (sum of segment haversine distances). */
export function polylineLengthKm(points: readonly [number, number][]): number {
  if (points.length < 2) return 0;
  let s = 0;
  for (let i = 1; i < points.length; i++) {
    s += haversineKm(points[i - 1], points[i]);
  }
  return s;
}

/** Point at `distanceKmFromStart` along polyline (linear interpolation within segment). */
export function pointAtDistanceAlongPolyline(
  points: readonly [number, number][],
  distanceKmFromStart: number
): [number, number] {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return [points[0][0], points[0][1]];
  let remaining = Math.max(0, distanceKmFromStart);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = haversineKm(a, b);
    if (remaining <= seg || i === points.length - 1) {
      const t = seg <= 1e-9 ? 0 : Math.min(1, remaining / seg);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= seg;
  }
  const last = points[points.length - 1];
  return [last[0], last[1]];
}
