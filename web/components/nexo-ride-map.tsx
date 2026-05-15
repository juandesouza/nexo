"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

export type LatLngTuple = readonly [number, number];

type NexoRideMapProps = {
  className?: string;
  /** Ride: rider at pickup. Delivery: omit (null); use pickup for restaurant only. */
  passenger: LatLngTuple | null;
  pickup: LatLngTuple | null;
  dropoff: LatLngTuple | null;
  driver: LatLngTuple | null;
  /** Marker semantics: ride (default) or delivery (restaurant/buyer). */
  variant?: "ride" | "delivery";
  /** Label for driver car marker tooltip (driver console → "You"). */
  driverMarkerTitle?: string;
  /** Degrees, clockwise from north; rotates the car marker for direction of travel. */
  driverBearing?: number | null;
  /** Driving routes as follow paths (multiple lines allowed — e.g. separate legs). */
  routePolylines?: readonly LatLngTuple[][];
  /** Per-polyline stroke (defaults to `#a78bfa` for each line). */
  routePolylineColors?: readonly string[];
};

export function NexoRideMap({
  className,
  passenger,
  pickup,
  dropoff,
  driver,
  variant = "ride",
  driverBearing,
  routePolylines,
  routePolylineColors,
  driverMarkerTitle = "Your driver"
}: NexoRideMapProps) {
  const personSvg =
    "<svg viewBox='0 0 24 24' width='24' height='24' aria-hidden='true'><circle cx='12' cy='5' r='3' fill='#22c55e'/><path d='M8 21v-5l-2-3a2 2 0 0 1 .6-2.8l2.6-1.6c1-.6 2.2-.6 3.2 0l2.6 1.6A2 2 0 0 1 15 13l-2 3v5h-2v-5h-2v5H8Z' fill='#16a34a'/></svg>";
  const carSvg =
    "<svg viewBox='0 0 24 24' width='26' height='26' aria-hidden='true'><path d='M5 12.5 7.2 7.8A2.5 2.5 0 0 1 9.5 6h5a2.5 2.5 0 0 1 2.3 1.5L19 12.5V17a1 1 0 0 1-1 1h-1a2 2 0 0 1-4 0h-2a2 2 0 0 1-4 0H6a1 1 0 0 1-1-1v-4.5Z' fill='#60a5fa'/><circle cx='8.5' cy='17.5' r='1.5' fill='#0f172a'/><circle cx='15.5' cy='17.5' r='1.5' fill='#0f172a'/></svg>";
  const pinSvg =
    "<svg viewBox='0 0 24 24' width='18' height='18' aria-hidden='true'><path d='M12 2a7 7 0 0 0-7 7c0 4.8 7 13 7 13s7-8.2 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z' fill='#f97316'/></svg>";
  const flagSvg =
    "<svg viewBox='0 0 24 24' width='18' height='18' aria-hidden='true'><path d='M6 3h2v18H6z' fill='#94a3b8'/><path d='M8 4h9l-1.5 3L17 10H8z' fill='#a78bfa'/></svg>";
  /** Commercial building — delivery pickup (restaurant). */
  const buildingSvg =
    "<svg viewBox='0 0 24 24' width='22' height='22' aria-hidden='true'><path fill='#475569' d='M5 21h14V8l-2-2H7L5 8v13zm2-2V10h10v9H7zm2-6h2v2H9v-2zm4 0h2v2h-2v-2zm-4 4h2v2H9v-2zm4 0h2v2h-2v-2z'/><path fill='#64748b' d='M8 6h8v2H8V6z'/></svg>";
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, { zoomControl: true }).setView([-23.55, -46.63], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = group;

    return () => {
      group.clearLayers();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerRef.current;
    if (!map || !group) return;

    group.clearLayers();
    const bounds = L.latLngBounds([]);
    const extend = (tuple: LatLngTuple) => bounds.extend(L.latLng(tuple[0], tuple[1]));
    const sameTuple = (a: LatLngTuple, b: LatLngTuple) =>
      Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5;
    const hidePickupPin = Boolean(
      passenger && pickup && sameTuple(passenger, pickup)
    );

    // Draw roads first so endpoint markers stay visible on top (driver drawn last).
    if (routePolylines?.length) {
      routePolylines.forEach((line, i) => {
        if (line.length < 2) return;
        const color = routePolylineColors?.[i] ?? "#a78bfa";
        L.polyline(
          line.map(([lat, lng]) => L.latLng(lat, lng)),
          { color, weight: 5, opacity: 0.9, lineJoin: "round", lineCap: "round" }
        ).addTo(group);
        for (const pt of line) extend(pt);
      });
    }

    if (passenger) {
      const passengerIcon = L.divIcon({
        className: "nexo-passenger-marker",
        html: `<div style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))">${personSvg}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      L.marker(L.latLng(passenger[0], passenger[1]), { icon: passengerIcon, zIndexOffset: 400 })
        .addTo(group)
        .bindTooltip(variant === "delivery" ? "Restaurant" : "Passenger", { permanent: false });
      extend(passenger);
    }

    if (pickup && !hidePickupPin) {
      const pickupIcon = L.divIcon({
        className: "nexo-pickup-marker",
        html: `<div style="width:${variant === "delivery" ? "22px" : "18px"};height:${variant === "delivery" ? "22px" : "18px"};display:flex;align-items:center;justify-content:center">${variant === "delivery" ? buildingSvg : pinSvg}</div>`,
        iconSize: variant === "delivery" ? [22, 22] : [18, 24],
        iconAnchor: variant === "delivery" ? [11, 11] : [9, 24]
      });
      L.marker(
        L.latLng(pickup[0], pickup[1]),
        { icon: pickupIcon, title: variant === "delivery" ? "Restaurant" : "Pickup", zIndexOffset: 500 }
      )
        .addTo(group)
        .bindTooltip(variant === "delivery" ? "Restaurant" : "Pickup", { permanent: false });
      extend(pickup);
    }

    if (dropoff) {
      const dropoffIcon = L.divIcon({
        className: "nexo-dropoff-marker",
        html: `<div style="width:24px;height:${variant === "delivery" ? "24px" : "28px"};display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))">${variant === "delivery" ? pinSvg : flagSvg}</div>`,
        iconSize: variant === "delivery" ? [22, 22] : [24, 28],
        iconAnchor: variant === "delivery" ? [11, 22] : [12, 28]
      });
      L.marker(
        L.latLng(dropoff[0], dropoff[1]),
        { icon: dropoffIcon, title: variant === "delivery" ? "Buyer" : "Drop-off", zIndexOffset: 1000 }
      )
        .addTo(group)
        .bindTooltip(variant === "delivery" ? "Buyer (drop-off)" : "Drop-off", { permanent: false });
      extend(dropoff);
    }

    if (driver) {
      const rot =
        driverBearing !== undefined && driverBearing !== null ? `rotate(${driverBearing}deg)` : "rotate(0deg)";
      const carIcon = L.divIcon({
        className: "nexo-car-marker",
        html: `<div style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));transform:${rot};transform-origin:center center">${carSvg}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });
      L.marker(L.latLng(driver[0], driver[1]), { icon: carIcon, zIndexOffset: 1100 })
        .addTo(group)
        .bindTooltip(driverMarkerTitle, { permanent: false });
      extend(driver);
    }

    if (bounds.isValid()) {
      // Avoid Leaflet zoom-transition race conditions during rapid React updates/unmounts.
      // Animated fitBounds can trigger `_leaflet_pos` errors when pane nodes are being removed.
      try {
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15, animate: false });
      } catch {
        // Ignore transient viewport update errors while map is tearing down.
      }
    }
  }, [passenger, pickup, dropoff, driver, variant, driverBearing, routePolylines, routePolylineColors, driverMarkerTitle]);

  return <div ref={wrapRef} className={className ?? "h-[320px] w-full rounded-2xl"} />;
}
