"use client";

import { motion } from "framer-motion";
import { NexoLogo } from "design-system";
import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { io, type Socket } from "socket.io-client";

const NexoRideMap = dynamic(() => import("../components/nexo-ride-map").then((m) => m.NexoRideMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[min(52vh,420px)] w-full items-center justify-center rounded-2xl border border-[#263553] bg-[#0f1524] text-sm text-slate-500">
      Loading map…
    </div>
  )
});
import {
  acceptDelivery,
  acceptRide,
  cancelRide,
  completeRide as completeRideApi,
  createRide,
  deleteAccountApi,
  getDriverPayoutStatus,
  fetchAuthProfile,
  getPaymentMethodStatus,
  loginWithEmail as loginWithEmailApi,
  loginWithGoogle as loginWithGoogleApi,
  setupPaymentMethod,
  setupDriverPayout,
  signUpWithEmail,
} from "../lib/api";
import { webEnv } from "../lib/env";
import {
  bearingDegrees,
  etaSeconds,
  haversineKm,
  polylineLengthKm,
  pointAtDistanceAlongPolyline,
  syntheticDriverStartNearPickup
} from "../lib/ride-geo";
import { appendRouteLegs, fetchRoadRoute, searchAddresses, type NominatimHit } from "../lib/routing-api";
import {
  appendRideHistory,
  clearAuthSession,
  getOrCreateGuestDriverId,
  getOrCreateGuestPassengerId,
  loadRideHistory,
  loadStoredToken,
  loadStoredUser,
  logoutLocal,
  persistAuth,
  persistLocationGateOk,
  persistUser,
  readLocationGateSatisfied,
  type SessionUser
} from "../lib/session";

type Tab = "passenger" | "driver" | "admin";

type FeedItem = {
  id: string;
  title: string;
  detail: string;
};

type Role = "passenger" | "driver";
type AuthMode = "login" | "signup";

type PendingRideOffer = {
  rideId: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  price: number;
  dropoffLabel?: string;
  routedDistanceKm?: number;
  distanceToPickupKm?: number;
};

type PendingDeliveryOffer = {
  deliveryId: string;
  orderId: string;
  restaurant: { lat: number; lng: number };
  customer: { lat: number; lng: number };
  status?: string;
};

type DriverLocationPayload = {
  rideId: string;
  driverId: string;
  lat: number;
  lng: number;
  etaSeconds?: number;
  remainingKm?: number;
};

type RidePhase = "idle" | "searching" | "matched" | "completed";

type LatLngTuple = readonly [number, number];

const KM_TO_MI = 0.621371;

/** Demo pricing until Yamma sends a quoted delivery payout on the offer payload. */
function estimateDeliveryPayoutUsd(totalTripMi: number): number {
  const base = 3.5;
  const perMi = 1.75;
  return Math.round((base + totalTripMi * perMi) * 100) / 100;
}

type GsiIdInitializeOptions = {
  client_id: string;
  callback: (response: { credential: string }) => void;
  /** FedCM One Tap often throws NetworkError on localhost / strict browsers; legacy path is reliable. */
  use_fedcm_for_prompt?: boolean;
  auto_select?: boolean;
  /** `redirect` avoids popup blockers / blank halfway through `popup` UX. */
  ux_mode?: "popup" | "redirect";
  /** Required when `ux_mode` is `redirect`. Google POSTs the credential JWT here. */
  login_uri?: string;
};

type GsiButtonConfiguration = {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  /** `continue_with` renders “Continue with Google”. */
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
  locale?: string;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: GsiIdInitializeOptions) => void;
          prompt: (momentListener?: unknown) => void;
          renderButton: (parent: HTMLElement, options: GsiButtonConfiguration) => void;
        };
      };
    };
  }
}

/** True in `next dev` or when NEXT_PUBLIC_PREFILL_TEST_PAYMENT_FORMS=true (demo / QA builds). */
const PREFILL_TEST_FORMS =
  typeof process !== "undefined" &&
  (process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_PREFILL_TEST_PAYMENT_FORMS === "true");

/** Braintree sandbox Visa test card (see PayPal developer docs). */
const SANDBOX_TEST_CARD_DEFAULTS = {
  holder: "Test User",
  number: "4111111111111111",
  /** Future MM/YY for local/testing runs. */
  expiry: "12/35",
  cvv: "123"
} satisfies Record<"holder" | "number" | "expiry" | "cvv", string>;

/** Pre-fill card inputs when `PREFILL_TEST_FORMS` is on. */
const TEST_PAYMENT_FIELD_DEFAULTS: typeof SANDBOX_TEST_CARD_DEFAULTS = PREFILL_TEST_FORMS
  ? SANDBOX_TEST_CARD_DEFAULTS
  : { holder: "", number: "", expiry: "", cvv: "" };

type DriverPayoutFormDefaults = { holder: string; destination: string };

const SAMPLE_DRIVER_PAYOUT_DEFAULTS: DriverPayoutFormDefaults = {
  holder: "Test Driver",
  destination: "driver.payout@test.nexo"
};

/** Same flag as passenger test card — pre-fills payout fields for faster driver testing. */
const DRIVER_PAYOUT_FIELD_DEFAULTS: DriverPayoutFormDefaults = PREFILL_TEST_FORMS
  ? SAMPLE_DRIVER_PAYOUT_DEFAULTS
  : { holder: "", destination: "" };

/** `next dev` only: skips the GPS gate — use when Cursor/IDE embedded browser blocks geolocation (not for production). */
const SKIP_LOCATION_GUARD_DEV =
  typeof process !== "undefined" &&
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_SKIP_LOCATION_GUARD_DEV === "true";

type GeolocationReadResult =
  | { ok: true; coords: [number, number] }
  | { ok: false; code?: number; noApi?: boolean };

type GeolocationFailure = Extract<GeolocationReadResult, { ok: false }>;

function geolocationFailureCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const c = (error as GeolocationPositionError).code;
  return typeof c === "number" ? c : undefined;
}

/** `GeolocationPositionError` codes — use literals so SSR/build never references browser-only globals. */
const GEO_PERM_DENIED = 1;
const GEO_UNAVAILABLE = 2;
const GEO_TIMEOUT = 3;

/** Two attempts: precise then network/cached-friendly (helps flaky / embedded-ish environments). */
async function readGeolocationCoordinates(): Promise<GeolocationReadResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { ok: false, noApi: true };
  }
  const geo = navigator.geolocation;
  const precise: PositionOptions = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 };
  const relaxed: PositionOptions = { enableHighAccuracy: false, timeout: 16_000, maximumAge: 120_000 };
  let last: GeolocationReadResult = { ok: false };

  for (const opts of [precise, relaxed]) {
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        geo.getCurrentPosition(resolve, reject, opts)
      );
      return { ok: true, coords: [position.coords.latitude, position.coords.longitude] };
    } catch (e: unknown) {
      const code = geolocationFailureCode(e);
      last = { ok: false, code };
      if (code === GEO_PERM_DENIED) {
        break;
      }
    }
  }
  return last;
}

function locationGateFallbackMessage(last: GeolocationFailure): string {
  const ideHint =
    " Cursor’s embedded browser and some IDE previews cannot use GPS — open http://localhost:3000 (or your dev URL) in Chrome/Firefox/Edge.";
  if (last.noApi) {
    return `This environment does not support geolocation.${ideHint}`;
  }
  switch (last.code) {
    case GEO_PERM_DENIED:
      return "Location permission was denied. Allow location for this site in your browser’s site settings.";
    case GEO_UNAVAILABLE:
      return `We could not read your position.${ideHint}`;
    case GEO_TIMEOUT:
      return "Getting your location timed out — try Wi‑Fi, move near a window, or try another browser.";
    default:
      return `We couldn’t verify your GPS location.${ideHint}`;
  }
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>("passenger");
  const [rideResult, setRideResult] = useState<string>("No ride requested yet.");
  const [driverMode, setDriverMode] = useState<"offline" | "online" | "busy">("online");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleChoice, setRoleChoice] = useState<Role>("passenger");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [locationGateOk, setLocationGateOk] = useState(false);
  const [locationGateError, setLocationGateError] = useState("");
  const [isGuest, setIsGuest] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [rideHistoryTick, setRideHistoryTick] = useState(0);
  const [portalMounted, setPortalMounted] = useState(false);
  const [currentRole, setCurrentRole] = useState<Role>("passenger");
  const [pendingOffer, setPendingOffer] = useState<PendingRideOffer | null>(null);
  const [pendingDeliveryOffer, setPendingDeliveryOffer] = useState<PendingDeliveryOffer | null>(null);
  const [ridePhase, setRidePhase] = useState<RidePhase>("idle");
  const [mapPassenger, setMapPassenger] = useState<LatLngTuple | null>(null);
  const [mapPickup, setMapPickup] = useState<LatLngTuple | null>(null);
  const [mapDropoff, setMapDropoff] = useState<LatLngTuple | null>(null);
  const [mapDriver, setMapDriver] = useState<LatLngTuple | null>(null);
  const [driverOnWayLabel, setDriverOnWayLabel] = useState("");
  const [etaToPickupSec, setEtaToPickupSec] = useState<number | null>(null);
  const [driverDistanceKm, setDriverDistanceKm] = useState<number | null>(null);
  const [driverBearing, setDriverBearing] = useState<number | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const roleChoiceRef = useRef(roleChoice);
  roleChoiceRef.current = roleChoice;
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const currentRoleRef = useRef<Role>(currentRole);
  const driverModeRef = useRef(driverMode);
  const expectingRideIdRef = useRef<string | null>(null);
  const carAnimRef = useRef<number | null>(null);
  const driveSimIntervalRef = useRef<number | null>(null);
  const activeTrackedRideRef = useRef<{ rideId: string; driverId: string; pickup: LatLngTuple } | null>(null);
  const prevDriverPosRef = useRef<[number, number] | null>(null);
  const driverOfferRouteRequestIdRef = useRef(0);
  /** Passenger-chosen destination (required before requesting a ride). */
  const [chosenDestination, setChosenDestination] = useState<{ label: string; lat: number; lng: number } | null>(
    null
  );
  const [goingToInput, setGoingToInput] = useState("");
  const [goingToSuggestions, setGoingToSuggestions] = useState<NominatimHit[]>([]);
  /** Road paths on maps (Leaflet coords). */
  const [passengerRoadPaths, setPassengerRoadPaths] = useState<LatLngTuple[][] | null>(null);
  const [driverOfferRoadPaths, setDriverOfferRoadPaths] = useState<LatLngTuple[][] | null>(null);
  const [driverDeliveryOfferRoadPaths, setDriverDeliveryOfferRoadPaths] = useState<LatLngTuple[][] | null>(null);
  /** Snapshot of preview roads after accept — keeps map visible during active delivery. */
  const [driverActiveDeliveryRoadPaths, setDriverActiveDeliveryRoadPaths] = useState<LatLngTuple[][] | null>(null);
  const [deliveryOfferMetrics, setDeliveryOfferMetrics] = useState<{
    toRestaurantMi: number;
    toCustomerMi: number;
    totalMi: number;
    estimatedPayoutUsd: number;
  } | null>(null);
  /** Road distances for the offer card preview (synthetic driver origin until accept). */
  const [driverOfferPreviewKm, setDriverOfferPreviewKm] = useState<{
    routedDistanceKm: number;
    distanceToPickupKm: number;
  } | null>(null);
  const [driverTripRoadPaths, setDriverTripRoadPaths] = useState<LatLngTuple[][] | null>(null);
  const [driverActiveRideId, setDriverActiveRideId] = useState<string | null>(null);
  const [driverActiveDeliveryId, setDriverActiveDeliveryId] = useState<string | null>(null);
  /** Yamma / delivery order status line for buyer (from `yamma:buyer:delivery`). */
  const [yammaBuyerOrderBanner, setYammaBuyerOrderBanner] = useState<{
    orderId: string;
    headline: string;
  } | null>(null);
  const [paymentConfigured, setPaymentConfigured] = useState(false);
  const [payoutConfigured, setPayoutConfigured] = useState(false);
  const [cardNumberInput, setCardNumberInput] = useState<string>(TEST_PAYMENT_FIELD_DEFAULTS.number);
  const [cardExpiryInput, setCardExpiryInput] = useState<string>(TEST_PAYMENT_FIELD_DEFAULTS.expiry);
  const [cardCvvInput, setCardCvvInput] = useState<string>(TEST_PAYMENT_FIELD_DEFAULTS.cvv);
  const [cardHolderInput, setCardHolderInput] = useState<string>(TEST_PAYMENT_FIELD_DEFAULTS.holder);
  const [payoutHolderInput, setPayoutHolderInput] = useState<string>(DRIVER_PAYOUT_FIELD_DEFAULTS.holder);
  const [payoutDestinationInput, setPayoutDestinationInput] = useState<string>(
    DRIVER_PAYOUT_FIELD_DEFAULTS.destination
  );
  currentRoleRef.current = currentRole;
  driverModeRef.current = driverMode;
  const pendingOfferRef = useRef<PendingRideOffer | null>(null);
  pendingOfferRef.current = pendingOffer;
  const pendingDeliveryOfferRef = useRef<PendingDeliveryOffer | null>(null);
  pendingDeliveryOfferRef.current = pendingDeliveryOffer;
  const driverActiveDeliveryIdRef = useRef<string | null>(null);
  driverActiveDeliveryIdRef.current = driverActiveDeliveryId;
  const driverActiveRideIdRef = useRef<string | null>(null);
  driverActiveRideIdRef.current = driverActiveRideId;

  function pushFeed(title: string, detail: string) {
    setFeed((prev) => [{ id: crypto.randomUUID(), title, detail }, ...prev].slice(0, 8));
  }

  /** Drops an incoming-driver offer overlay and restores the idle driver map area. */
  function dismissDriverIncomingOfferMaps() {
    driverOfferRouteRequestIdRef.current += 1;
    setPendingOffer(null);
    setDriverOfferRoadPaths(null);
    setDriverOfferPreviewKm(null);
    setMapPassenger(null);
    setMapPickup(null);
    setMapDropoff(null);
    setMapDriver(null);
    stopCarAnimation();
    setEtaToPickupSec(null);
    setDriverDistanceKm(null);
  }

  function dismissDriverIncomingDeliveryOffer() {
    setPendingDeliveryOffer(null);
    setDriverDeliveryOfferRoadPaths(null);
    setDeliveryOfferMetrics(null);
    setMapPassenger(null);
    setMapPickup(null);
    setMapDropoff(null);
  }

  function stopCarAnimation() {
    if (carAnimRef.current !== null) {
      cancelAnimationFrame(carAnimRef.current);
      carAnimRef.current = null;
    }
    prevDriverPosRef.current = null;
    setDriverBearing(null);
  }

  function stopDriveSimulation() {
    if (driveSimIntervalRef.current !== null) {
      window.clearInterval(driveSimIntervalRef.current);
      driveSimIntervalRef.current = null;
    }
  }

  function bypassLocationGateDevOnly() {
    if (!SKIP_LOCATION_GUARD_DEV) return;
    persistLocationGateOk();
    setLocationGateError("");
    setLocationGateOk(true);
    pushFeed("Location gate (dev bypass)", "Skipped GPS check — NEXT_PUBLIC_SKIP_LOCATION_GUARD_DEV=true; use Chrome for real positioning.");
  }

  async function requestLocationGateAccess() {
    setLocationGateError("");
    const result = await readGeolocationCoordinates();
    if (!result.ok) {
      setLocationGateError(locationGateFallbackMessage(result));
      return;
    }
    persistLocationGateOk();
    setLocationGateOk(true);
  }

  async function readCurrentPosition(): Promise<[number, number] | null> {
    const result = await readGeolocationCoordinates();
    return result.ok ? result.coords : null;
  }

  function startRoadTripSimulation(payload: {
    rideId: string;
    driverId: string;
    pickup: LatLngTuple;
    legToPickup: [number, number][];
    legPickupToDropoff: [number, number][];
  }) {
    stopDriveSimulation();
    const socket = socketRef.current;
    if (!socket?.connected) return;

    if (payload.legToPickup.length < 2 || payload.legPickupToDropoff.length < 2) {
      return;
    }

    const speedKmh = 28;
    const tickMs = 700;
    const kmPerTick = (speedKmh / 3600) * (tickMs / 1000);
    const leg1Len = Math.max(1e-6, polylineLengthKm(payload.legToPickup));
    const leg2Len = Math.max(1e-6, polylineLengthKm(payload.legPickupToDropoff));

    let phase: 1 | 2 = 1;
    let travelledKm = 0;

    const first = pointAtDistanceAlongPolyline(payload.legToPickup, 0);
    setMapDriver(first);
    setRidePhase("matched");
    activeTrackedRideRef.current = {
      rideId: payload.rideId,
      driverId: payload.driverId,
      pickup: payload.pickup
    };

    driveSimIntervalRef.current = window.setInterval(() => {
      const coords = phase === 1 ? payload.legToPickup : payload.legPickupToDropoff;
      const legLen = phase === 1 ? leg1Len : leg2Len;

      travelledKm += kmPerTick;
      if (travelledKm >= legLen) travelledKm = legLen;

      const pos = pointAtDistanceAlongPolyline(coords, travelledKm);
      const prev = prevDriverPosRef.current;
      if (prev) {
        setDriverBearing(bearingDegrees(prev, pos) - 90);
      }
      prevDriverPosRef.current = pos;
      setMapDriver(pos);

      const remain = Math.max(0, legLen - travelledKm);
      const etaSec = etaSeconds(remain, speedKmh);
      setEtaToPickupSec(etaSec);
      setDriverDistanceKm(remain);

      socket.emit("driver:location", {
        rideId: payload.rideId,
        driverId: payload.driverId,
        lat: pos[0],
        lng: pos[1],
        etaSeconds: etaSec,
        remainingKm: remain
      });

      if (travelledKm >= legLen - 1e-10) {
        if (phase === 1) {
          socket.emit("ride:status", { rideId: payload.rideId, status: "driver_arrived_pickup" });
          setMapPassenger(null);
          phase = 2;
          travelledKm = 0;
          pushFeed("Driver at pickup", "En route to passenger drop-off.");
        } else {
          stopDriveSimulation();
          socket.emit("ride:status", { rideId: payload.rideId, status: "driver_arrived_dropoff" });
          void completeRideApi(payload.rideId).catch(() => {
            // keep simulation UX even if completion API transiently fails
          });
          setRidePhase("completed");
          setDriverMode("online");
          setDriverActiveRideId(null);
          setEtaToPickupSec(0);
          setDriverDistanceKm(0);
          setDriverOnWayLabel("");
          pushFeed("Trip completed", "Reached drop-off.");
        }
      }
    }, tickMs);
  }

  async function loginOrSignUpWithEmail() {
    if (!email.includes("@")) {
      setError("Enter a valid email.");
      return;
    }
    if (password.length < 8) {
      setError("Password must have at least 8 characters.");
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      const auth =
        authMode === "signup"
          ? await signUpWithEmail({ email, password, role: roleChoice })
          : await loginWithEmailApi({ email, password });
      persistAuth(auth);
      setSessionUser(auth.user);
      setIsGuest(false);
      setIsAuthenticated(true);
      setCurrentRole(auth.user.role);
      setActiveTab(auth.user.role);
      pushFeed("Session Started", `${authMode === "signup" ? "Signed up" : "Logged in"} as ${auth.user.role}.`);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Authentication failed.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  function loginAsGuest(role: Role) {
    setError("");
    setSessionUser(null);
    setIsGuest(true);
    setIsAuthenticated(true);
    setCurrentRole(role);
    setActiveTab(role);
    pushFeed("Guest Session", `Entered as ${role} guest.`);
    if (role === "passenger") {
      getOrCreateGuestPassengerId();
    }
    if (role === "driver") {
      getOrCreateGuestDriverId();
    }
  }

  function handleLogout() {
    setLocationGateOk(false);
    setLocationGateError("");
    logoutLocal();
    stopCarAnimation();
    stopDriveSimulation();
    setProfileOpen(false);
    setSessionUser(null);
    setIsGuest(false);
    setIsAuthenticated(false);
    setCurrentRole("passenger");
    setActiveTab("passenger");
    setRideResult("No ride requested yet.");
    setPendingOffer(null);
    setRidePhase("idle");
    setMapPassenger(null);
    setMapPickup(null);
    setMapDropoff(null);
    setMapDriver(null);
    setEtaToPickupSec(null);
    setDriverDistanceKm(null);
    setDriverOnWayLabel("");
    activeTrackedRideRef.current = null;
    expectingRideIdRef.current = null;
    setChosenDestination(null);
    setGoingToInput("");
    setGoingToSuggestions([]);
    setPassengerRoadPaths(null);
    setDriverOfferRoadPaths(null);
    setDriverOfferPreviewKm(null);
    setDriverTripRoadPaths(null);
    setDriverDeliveryOfferRoadPaths(null);
    setDriverActiveRideId(null);
    setDriverActiveDeliveryId(null);
    setDriverActiveDeliveryRoadPaths(null);
    setYammaBuyerOrderBanner(null);
    setPaymentConfigured(false);
    setPayoutConfigured(false);
    setCardNumberInput(TEST_PAYMENT_FIELD_DEFAULTS.number);
    setCardExpiryInput(TEST_PAYMENT_FIELD_DEFAULTS.expiry);
    setCardCvvInput(TEST_PAYMENT_FIELD_DEFAULTS.cvv);
    setCardHolderInput(TEST_PAYMENT_FIELD_DEFAULTS.holder);
    setPayoutHolderInput(DRIVER_PAYOUT_FIELD_DEFAULTS.holder);
    setPayoutDestinationInput(DRIVER_PAYOUT_FIELD_DEFAULTS.destination);
    stopCarAnimation();
    socketRef.current?.disconnect();
    socketRef.current = null;
    setError("");
    setFeed([]);
  }

  async function handleDeleteAccount() {
    const token = loadStoredToken();
    if (!token || isGuest) return;
    const ok = typeof window !== "undefined" ? window.confirm("Delete your account? This cannot be undone.") : false;
    if (!ok) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteAccountApi(token);
      stopCarAnimation();
      stopDriveSimulation();
      setLocationGateOk(false);
      setLocationGateError("");
      logoutLocal();
      setProfileOpen(false);
      setSessionUser(null);
      setIsGuest(false);
      setIsAuthenticated(false);
      setCurrentRole("passenger");
      setActiveTab("passenger");
      setRideResult("No ride requested yet.");
      setPendingOffer(null);
      setRidePhase("idle");
      setMapPassenger(null);
      setMapPickup(null);
      setMapDropoff(null);
      setMapDriver(null);
      setEtaToPickupSec(null);
      setDriverDistanceKm(null);
      setDriverOnWayLabel("");
      activeTrackedRideRef.current = null;
      expectingRideIdRef.current = null;
      setChosenDestination(null);
      setGoingToInput("");
      setGoingToSuggestions([]);
      setPassengerRoadPaths(null);
      setDriverOfferRoadPaths(null);
      setDriverOfferPreviewKm(null);
      setDriverTripRoadPaths(null);
      setDriverDeliveryOfferRoadPaths(null);
      setDriverActiveRideId(null);
      setDriverActiveDeliveryId(null);
      setDriverActiveDeliveryRoadPaths(null);
      setYammaBuyerOrderBanner(null);
      setPaymentConfigured(false);
      setPayoutConfigured(false);
      setCardNumberInput(TEST_PAYMENT_FIELD_DEFAULTS.number);
      setCardExpiryInput(TEST_PAYMENT_FIELD_DEFAULTS.expiry);
      setCardCvvInput(TEST_PAYMENT_FIELD_DEFAULTS.cvv);
      setCardHolderInput(TEST_PAYMENT_FIELD_DEFAULTS.holder);
      setPayoutHolderInput(DRIVER_PAYOUT_FIELD_DEFAULTS.holder);
      setPayoutDestinationInput(DRIVER_PAYOUT_FIELD_DEFAULTS.destination);
      stopCarAnimation();
      setFeed([]);
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Could not delete account.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const googleErr = params.get("google_err");
    if (googleErr) {
      setError(`Google sign-in failed (${googleErr}). Try again or use email.`);
      params.delete("google_err");
      const rest = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    }

    const existingToken = loadStoredToken();
    const storedUser = loadStoredUser();
    if (existingToken) {
      setIsAuthenticated(true);
      setIsGuest(false);
      if (storedUser) {
        setSessionUser(storedUser);
        setCurrentRole(storedUser.role);
      } else {
        void (async () => {
          try {
            const u = await fetchAuthProfile(existingToken);
            persistUser(u);
            setSessionUser(u);
            setCurrentRole(u.role);
          } catch {
            clearAuthSession();
            setIsAuthenticated(false);
            setSessionUser(null);
          }
        })();
      }
    }
  }, []);

  useEffect(() => {
    setPortalMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isAuthenticated) {
      setLocationGateOk(false);
      setLocationGateError("");
      return;
    }
    setLocationGateOk(readLocationGateSatisfied());
  }, [isAuthenticated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (ridePhase === "searching") return;
    const q = goingToInput.trim();
    if (q.length < 3) {
      setGoingToSuggestions([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchAddresses(q).then((hits) => {
        setGoingToSuggestions(hits.slice(0, 7));
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [goingToInput, ridePhase]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.cookie = `nexo_oauth_role=${encodeURIComponent(roleChoice)}; Path=/; Max-Age=3600; SameSite=Lax`;
  }, [roleChoice]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const clientId = webEnv.NEXT_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID;
    const looksPlaceholder =
      !clientId ||
      clientId.includes("your-") ||
      clientId === "local-web-client-id" ||
      !clientId.includes(".apps.googleusercontent.com");

    if (looksPlaceholder) {
      setError(
        "Set a real NEXT_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID in web/.env.local (Web OAuth client)."
      );
      setGoogleReady(false);
      return;
    }

    const gsiOptions: GsiIdInitializeOptions = {
      client_id: clientId,
      use_fedcm_for_prompt: false,
      auto_select: false,
      ux_mode: "redirect",
      login_uri: `${window.location.origin}/api/auth/google/callback`,
      callback: async ({ credential }) => {
        const role = roleChoiceRef.current;
        setIsLoading(true);
        setError("");
        try {
          const auth = await loginWithGoogleApi({ token: credential, role });
          persistAuth(auth);
          setSessionUser(auth.user);
          setIsGuest(false);
          setIsAuthenticated(true);
          setCurrentRole(auth.user.role);
          setActiveTab(auth.user.role);
          pushFeed("Session Started", `Logged in with Google as ${auth.user.role}.`);
        } catch (requestError) {
          const message =
            requestError instanceof Error ? requestError.message : "Google authentication failed.";
          setError(message);
        } finally {
          setIsLoading(false);
        }
      }
    };

    const wireGsi = () => {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize(gsiOptions);
      setGoogleReady(true);
    };

    let script = document.getElementById("google-identity-services") as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = "google-identity-services";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => wireGsi();
      document.body.appendChild(script);
      return;
    }

    if (window.google?.accounts?.id) {
      wireGsi();
    } else {
      script.addEventListener("load", wireGsi, { once: true });
    }
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (isAuthenticated || !googleReady || !window.google?.accounts?.id) return;

    const el = googleButtonRef.current;
    if (!el) return;

    el.replaceChildren();
    window.google.accounts.id.renderButton(el, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: 280,
      locale: "en"
    });
  }, [googleReady, isAuthenticated]);

  function syncSocketMembership(socket: Socket) {
    if (!socket.connected) return;

    const listenPassenger = currentRole === "passenger";
    const listenDriver = currentRole === "driver" && driverMode === "online";

    if (listenPassenger) {
      let passengerId = sessionUser?.id;
      if (!passengerId && isGuest && currentRole === "passenger") {
        passengerId = getOrCreateGuestPassengerId();
      }
      if (passengerId) {
        socket.emit("passenger:join", { passengerId });
      }
    }

    if (listenDriver) {
      let driverId = sessionUser?.id;
      if (!driverId && isGuest) {
        driverId = getOrCreateGuestDriverId();
      }
      if (driverId) {
        socket.emit("driver:join", { driverId });
      }
    } else {
      socket.emit("driver:leave");
    }
  }

  async function ensurePassengerSocketReady(passengerId: string): Promise<void> {
    const socket = socketRef.current;
    if (!socket) {
      throw new Error("Realtime not initialized. Wait a second and try again.");
    }

    const join = () => {
      socket.emit("passenger:join", { passengerId });
    };

    if (socket.connected) {
      join();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            "Timed out connecting to the ride server. Check NEXT_PUBLIC_WS_URL and that the backend is running."
          )
        );
      }, 12_000);

      const cleanup = () => {
        clearTimeout(timeout);
        socket.off("connect", onConnect);
        socket.off("connect_error", onErr);
      };

      const onConnect = () => {
        cleanup();
        join();
        resolve();
      };

      const onErr = () => {
        cleanup();
        reject(new Error("Could not reach the ride server. Is the backend running on the API host?"));
      };

      socket.once("connect", onConnect);
      socket.once("connect_error", onErr);
    });
  }

  useEffect(() => {
    if (!isAuthenticated || typeof window === "undefined") {
      stopDriveSimulation();
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }
    if (!locationGateOk) {
      stopDriveSimulation();
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = io(webEnv.NEXT_PUBLIC_WS_URL, {
      transports: ["websocket", "polling"],
      path: "/socket.io"
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      syncSocketMembership(socket);
    });

    socket.on(
      "ride:offer",
      (payload: {
        ride?: Omit<PendingRideOffer, "rideId"> & { id?: string; passengerId?: string; status?: string };
      }) => {
        const ride = payload?.ride;
        if (!ride?.id) return;
        if (currentRoleRef.current !== "driver" || driverModeRef.current !== "online") return;

        driverOfferRouteRequestIdRef.current += 1;
        setDriverOfferRoadPaths(null);
        setDriverOfferPreviewKm(null);
        setDriverDistanceKm(null);
        const pickupTuple: [number, number] = [ride.pickup.lat, ride.pickup.lng];
        setMapDriver(null);
        setMapPassenger(pickupTuple);
        setMapPickup(pickupTuple);
        setMapDropoff([ride.dropoff.lat, ride.dropoff.lng]);
        setDriverTripRoadPaths(null);

        setPendingOffer({
          rideId: ride.id,
          pickup: ride.pickup,
          dropoff: ride.dropoff,
          price: ride.price,
          dropoffLabel: ride.dropoffLabel,
          routedDistanceKm: ride.routedDistanceKm,
          distanceToPickupKm: ride.distanceToPickupKm
        });
        pushFeed(
          "Ride offer",
          `New request ${ride.id.slice(0, 8)}… — tap Accept to confirm your road route and locked fare.`
        );
      }
    );

    socket.on(
      "delivery:offer",
      (payload: {
        delivery?: {
          id?: string;
          orderId?: string;
          restaurant?: { lat: number; lng: number };
          customer?: { lat: number; lng: number };
          status?: string;
        };
      }) => {
        const d = payload?.delivery;
        if (!d?.id || !d?.orderId || !d.restaurant || !d.customer) return;
        if (currentRoleRef.current !== "driver" || driverModeRef.current !== "online") return;
        setPendingDeliveryOffer({
          deliveryId: d.id,
          orderId: d.orderId,
          restaurant: d.restaurant,
          customer: d.customer,
          status: d.status
        });
        setDeliveryOfferMetrics(null);
        setDriverDeliveryOfferRoadPaths(null);
        setMapPassenger([d.restaurant.lat, d.restaurant.lng]);
        setMapPickup([d.restaurant.lat, d.restaurant.lng]);
        setMapDropoff([d.customer.lat, d.customer.lng]);
        pushFeed("Delivery offer", `Order ${d.orderId.slice(0, 8)}… is ready for pickup.`);
      }
    );

    socket.on("delivery:taken", (payload: { deliveryId?: string }) => {
      const deliveryId = payload?.deliveryId;
      if (!deliveryId) return;
      if (pendingDeliveryOfferRef.current?.deliveryId !== deliveryId) return;
      dismissDriverIncomingDeliveryOffer();
    });

    socket.on("delivery:status:updated", (payload: { deliveryId?: string; status?: string; orderId?: string }) => {
      if (currentRoleRef.current !== "driver" || !payload.deliveryId || !payload.status) return;
      if (payload.deliveryId !== driverActiveDeliveryIdRef.current) return;
      if (payload.status === "delivered" || payload.status === "canceled") {
        setDriverActiveDeliveryId(null);
        setDriverActiveDeliveryRoadPaths(null);
        setMapPickup(null);
        setMapDropoff(null);
        setMapDriver(null);
        if (driverActiveRideIdRef.current == null) {
          setDriverMode("online");
        }
      }
    });

    socket.on(
      "yamma:buyer:delivery",
      (payload: {
        orderId?: string;
        buyerHeadline?: string;
        buyerFacingStatus?: string;
        event?: string;
      }) => {
        if (currentRoleRef.current !== "passenger") return;
        const orderId = payload?.orderId;
        const headline = payload?.buyerHeadline;
        if (!orderId || !headline) return;
        setYammaBuyerOrderBanner({ orderId, headline });
        pushFeed("Your order", `Order ${orderId.slice(0, 8)}… — ${headline}`);
      }
    );

    socket.on("ride:taken", (payload: { rideId?: string }) => {
      const rideId = payload?.rideId;
      if (!rideId) return;
      if (pendingOfferRef.current?.rideId !== rideId) return;
      dismissDriverIncomingOfferMaps();
    });

    socket.on(
      "ride:accepted",
      (payload: {
        rideId: string;
        driverId: string;
        driverName?: string;
        pickup: { lat: number; lng: number };
        dropoff: { lat: number; lng: number };
        price: number;
        routedDistanceKm?: number;
        distanceToPickupKm?: number;
        driverLat?: number;
        driverLng?: number;
      }) => {
        if (payload.rideId !== expectingRideIdRef.current) return;
        setRidePhase("matched");
        activeTrackedRideRef.current = {
          rideId: payload.rideId,
          driverId: payload.driverId,
          pickup: [payload.pickup.lat, payload.pickup.lng]
        };
        const driverPos: [number, number] =
          typeof payload.driverLat === "number" &&
          typeof payload.driverLng === "number" &&
          Number.isFinite(payload.driverLat) &&
          Number.isFinite(payload.driverLng)
            ? [payload.driverLat, payload.driverLng]
            : syntheticDriverStartNearPickup({ lat: payload.pickup.lat, lng: payload.pickup.lng });
        const pickupPt: [number, number] = [payload.pickup.lat, payload.pickup.lng];
        setMapDriver(driverPos);
        prevDriverPosRef.current = driverPos;
        setDriverBearing(bearingDegrees(driverPos, pickupPt) - 90);

        const rideIdAccepted = payload.rideId;
        void (async () => {
          const legToPickupPassenger = await fetchRoadRoute(
            [
              { lat: driverPos[0], lng: driverPos[1] },
              { lat: payload.pickup.lat, lng: payload.pickup.lng }
            ],
            { snapEnds: true }
          );
          const legToDestPassenger = await fetchRoadRoute(
            [
              { lat: payload.pickup.lat, lng: payload.pickup.lng },
              { lat: payload.dropoff.lat, lng: payload.dropoff.lng }
            ],
            { snapEnds: true }
          );
          if (expectingRideIdRef.current !== rideIdAccepted || currentRoleRef.current !== "passenger") {
            return;
          }
          if (!legToPickupPassenger?.coordinates?.length || !legToDestPassenger?.coordinates?.length) {
            return;
          }
          setPassengerRoadPaths([
            legToPickupPassenger.coordinates,
            legToDestPassenger.coordinates
          ]);
        })();

        const km =
          typeof payload.routedDistanceKm === "number" ? payload.routedDistanceKm.toFixed(2) : null;
        setRideResult(
          `Driver matched | ride ${payload.rideId.slice(0, 8)}… | fare $${payload.price.toFixed(2)} (${
            km ? `${km} km trip` : "driver-route pricing"
          }) | driver ${payload.driverId.slice(0, 8)}…`
        );
        appendRideHistory({
          id: payload.rideId,
          summary: `Accepted | fare $${payload.price.toFixed(2)} (${km ? `${km} km` : "routed"} trip)`
        });
        setRideHistoryTick((n) => n + 1);
        const displayName = payload.driverName?.trim() || `Driver ${payload.driverId.slice(0, 6)}`;
        setDriverOnWayLabel(`${displayName} is on the way!`);
        setEtaToPickupSec(null);
        pushFeed(
          "Fare finalized",
          `Your price is locked from the assigned driver’s live route (~${km ?? "—"} km).`
        );
      }
    );

    socket.on("driver:location:updated", (payload: DriverLocationPayload) => {
      if (currentRoleRef.current !== "passenger") return;
      const tracked = activeTrackedRideRef.current;
      if (!tracked || payload.rideId !== tracked.rideId) return;
      const pos: [number, number] = [payload.lat, payload.lng];
      const prev = prevDriverPosRef.current;
      if (prev) {
        const brg = bearingDegrees(prev, pos);
        setDriverBearing(brg - 90);
      }
      prevDriverPosRef.current = pos;
      setMapDriver(pos);
      if (typeof payload.etaSeconds === "number") {
        setEtaToPickupSec(payload.etaSeconds);
      }
      if (typeof payload.remainingKm === "number") {
        setDriverDistanceKm(payload.remainingKm);
      }
    });

    socket.on("ride:status:updated", (payload: { rideId?: string; status?: string }) => {
      if (currentRoleRef.current !== "passenger") return;
      const rideId = payload?.rideId;
      if (!rideId) return;

      if (
        payload.status === "canceled" &&
        (expectingRideIdRef.current === rideId ||
          activeTrackedRideRef.current?.rideId === rideId)
      ) {
        const wasMatched = !!activeTrackedRideRef.current && activeTrackedRideRef.current.rideId === rideId;
        expectingRideIdRef.current = null;
        activeTrackedRideRef.current = null;
        setRidePhase("idle");
        setMapDriver(null);
        setMapPassenger(null);
        setMapPickup(null);
        setPassengerRoadPaths(null);
        setEtaToPickupSec(null);
        setDriverDistanceKm(null);
        setDriverOnWayLabel("");
        if (wasMatched) {
          setRideResult("Ride canceled.");
          pushFeed("Ride canceled", "Your trip was canceled — you can request again.");
        } else {
          setRideResult("Search canceled.");
          pushFeed("Search canceled", "You stopped looking for a driver — request again anytime.");
        }
        return;
      }

      const tracked = activeTrackedRideRef.current;
      if (!tracked || rideId !== tracked.rideId) return;
      if (payload.status === "driver_arrived_pickup") {
        setMapPassenger(null);
        setEtaToPickupSec(null);
        setDriverOnWayLabel("Heading to your destination");
        pushFeed("Pickup complete", "Driving to your drop-off along the route.");
      }
      if (payload.status === "driver_arrived_dropoff") {
        setRidePhase("completed");
        setEtaToPickupSec(0);
        setDriverDistanceKm(0);
        setDriverOnWayLabel("");
        pushFeed("Trip finished", "Driver reached the destination.");
      }
    });

    socket.on("ride:status:updated", (payload: { rideId?: string; status?: string }) => {
      if (currentRoleRef.current !== "driver") return;
      if (!payload.rideId || payload.rideId !== driverActiveRideId) return;
      if (payload.status === "canceled") {
        stopDriveSimulation();
        setDriverMode("online");
        setDriverActiveRideId(null);
        setRidePhase("idle");
        setMapDriver(null);
        setMapPassenger(null);
        setMapPickup(null);
        setMapDropoff(null);
        setDriverTripRoadPaths(null);
        setEtaToPickupSec(null);
        setDriverDistanceKm(null);
        pushFeed("Ride canceled", "Current ride was canceled.");
      }
    });

    return () => {
      stopDriveSimulation();
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [
    isAuthenticated,
    locationGateOk,
    sessionUser?.id,
    isGuest,
    currentRole,
    driverMode,
    activeTab,
    driverActiveRideId
  ]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    syncSocketMembership(socket);
  }, [sessionUser?.id, isGuest, currentRole, driverMode, activeTab]);

  useEffect(() => {
    const offer = pendingOffer;
    if (!offer || currentRole !== "driver" || !locationGateOk || !isAuthenticated) {
      return;
    }

    let canceled = false;
    const offerRideId = offer.rideId;

    void (async () => {
      const posResult = await readGeolocationCoordinates();
      if (canceled) return;
      const start = posResult.ok
        ? posResult.coords
        : syntheticDriverStartNearPickup({ lat: offer.pickup.lat, lng: offer.pickup.lng });

      const legToPickup = await fetchRoadRoute(
        [
          { lat: start[0], lng: start[1] },
          { lat: offer.pickup.lat, lng: offer.pickup.lng }
        ],
        { snapEnds: true }
      );
      const legToDrop = await fetchRoadRoute(
        [
          { lat: offer.pickup.lat, lng: offer.pickup.lng },
          { lat: offer.dropoff.lat, lng: offer.dropoff.lng }
        ],
        { snapEnds: true }
      );

      if (canceled) return;
      if (pendingOfferRef.current?.rideId !== offerRideId) return;

      if (!legToPickup?.coordinates?.length || !legToDrop?.coordinates?.length) {
        setDriverOfferRoadPaths(null);
        setDriverOfferPreviewKm(null);
        return;
      }

      const merged = appendRouteLegs(legToPickup.coordinates, legToDrop.coordinates);
      setDriverOfferRoadPaths([merged]);
      setMapDriver(start);

      const legMPickup =
        (legToPickup.distanceMeters ?? 0) > 1
          ? legToPickup.distanceMeters!
          : polylineLengthKm(legToPickup.coordinates) * 1000;
      const legMDrop =
        (legToDrop.distanceMeters ?? 0) > 1
          ? legToDrop.distanceMeters!
          : polylineLengthKm(legToDrop.coordinates) * 1000;
      setDriverOfferPreviewKm({
        routedDistanceKm: (legMPickup + legMDrop) / 1000,
        distanceToPickupKm: legMPickup / 1000
      });
    })();

    return () => {
      canceled = true;
    };
  }, [pendingOffer, currentRole, locationGateOk, isAuthenticated]);

  useEffect(() => {
    const offer = pendingDeliveryOffer;
    if (!offer || currentRole !== "driver" || !locationGateOk || !isAuthenticated) {
      return;
    }

    let canceled = false;
    const offerId = offer.deliveryId;

    void (async () => {
      const posResult = await readGeolocationCoordinates();
      if (canceled) return;
      const start: LatLngTuple = posResult.ok
        ? posResult.coords
        : syntheticDriverStartNearPickup({ lat: offer.restaurant.lat, lng: offer.restaurant.lng });
      const restaurantPt: LatLngTuple = [offer.restaurant.lat, offer.restaurant.lng];
      const customerPt: LatLngTuple = [offer.customer.lat, offer.customer.lng];

      // Snap only the driver onto the road for leg 1 — snapping the restaurant can break OSRM vs. leg 2.
      const legToRestaurant = await fetchRoadRoute(
        [
          { lat: start[0], lng: start[1] },
          { lat: offer.restaurant.lat, lng: offer.restaurant.lng }
        ],
        { snapProfile: "start", attempts: 4 }
      );
      const legToCustomer = await fetchRoadRoute(
        [
          { lat: offer.restaurant.lat, lng: offer.restaurant.lng },
          { lat: offer.customer.lat, lng: offer.customer.lng }
        ],
        { snapProfile: "both", attempts: 4 }
      );
      if (canceled) return;
      if (pendingDeliveryOfferRef.current?.deliveryId !== offerId) return;

      const okR =
        Boolean(legToRestaurant?.coordinates && legToRestaurant.coordinates.length >= 2);
      const okC = Boolean(legToCustomer?.coordinates && legToCustomer.coordinates.length >= 2);

      const segR: LatLngTuple[] =
        okR && legToRestaurant?.coordinates ? [...legToRestaurant.coordinates] : [];
      const segC: LatLngTuple[] =
        okC && legToCustomer?.coordinates ? [...legToCustomer.coordinates] : [];
      const hasAnyRoadLine = segR.length >= 2 || segC.length >= 2;
      setDriverDeliveryOfferRoadPaths(hasAnyRoadLine ? [segR, segC] : null);

      const kmR = okR
        ? Math.max(
            0,
            (legToRestaurant!.distanceMeters ?? 0) > 1
              ? legToRestaurant!.distanceMeters! / 1000
              : polylineLengthKm(legToRestaurant!.coordinates)
          )
        : haversineKm(start, restaurantPt);
      const kmC = okC
        ? Math.max(
            0,
            (legToCustomer!.distanceMeters ?? 0) > 1
              ? legToCustomer!.distanceMeters! / 1000
              : polylineLengthKm(legToCustomer!.coordinates)
          )
        : haversineKm(restaurantPt, customerPt);

      const miR = kmR * KM_TO_MI;
      const miC = kmC * KM_TO_MI;
      setDeliveryOfferMetrics({
        toRestaurantMi: miR,
        toCustomerMi: miC,
        totalMi: miR + miC,
        estimatedPayoutUsd: estimateDeliveryPayoutUsd(miR + miC)
      });
      if (okR && legToRestaurant?.coordinates && legToRestaurant.coordinates.length >= 2) {
        const p0 = legToRestaurant.coordinates[0];
        setMapDriver([p0[0], p0[1]]);
      } else {
        setMapDriver(start);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [pendingDeliveryOffer, currentRole, locationGateOk, isAuthenticated]);

  /** Move driver marker along GPS while fulfilling a delivery (no manual status steps). */
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    if (!locationGateOk || !isAuthenticated || currentRole !== "driver") return;
    if (!driverActiveDeliveryId) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setMapDriver([pos.coords.latitude, pos.coords.longitude]);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [currentRole, driverActiveDeliveryId, locationGateOk, isAuthenticated]);

  useEffect(() => {
    if (currentRole === "passenger") {
      const passengerId = sessionUser?.id ?? (isGuest ? getOrCreateGuestPassengerId() : null);
      if (!passengerId) {
        setPaymentConfigured(false);
        return;
      }
      void getPaymentMethodStatus(passengerId)
        .then((res) => setPaymentConfigured(Boolean(res?.configured)))
        .catch(() => setPaymentConfigured(false));
      return;
    }
    if (currentRole === "driver") {
      const driverId = sessionUser?.id ?? (isGuest ? getOrCreateGuestDriverId() : null);
      if (!driverId) {
        setPayoutConfigured(false);
        return;
      }
      void getDriverPayoutStatus(driverId)
        .then((res) => setPayoutConfigured(Boolean(res?.configured)))
        .catch(() => setPayoutConfigured(false));
      return;
    }
  }, [currentRole, sessionUser?.id, isGuest]);

  useEffect(() => {
    if (!isAuthenticated || !locationGateOk) return;
    if (currentRole !== "passenger" || activeTab !== "passenger") return;
    if (ridePhase !== "idle") return;
    if (expectingRideIdRef.current) return;

    let canceled = false;
    void (async () => {
      const pos = await readCurrentPosition();
      if (!pos || canceled) return;
      setMapPassenger(pos);
      setMapPickup(pos);
      setMapDriver(null);
      setEtaToPickupSec(null);
      setDriverDistanceKm(null);
      setDriverOnWayLabel("");
    })();

    return () => {
      canceled = true;
    };
  }, [isAuthenticated, locationGateOk, currentRole, activeTab, ridePhase]);

  async function handleRideRequest() {
    let passengerId: string | undefined = sessionUser?.id;
    if (!passengerId && isGuest && currentRole === "passenger") {
      passengerId = getOrCreateGuestPassengerId();
    }
    if (!passengerId) {
      setError("Sign in or use “Enter as Passenger Guest” to get a rider id.");
      return;
    }

    if (!chosenDestination) {
      setError("Choose where you’re going (Going to) before requesting a ride.");
      return;
    }
    if (!paymentConfigured) {
      setError("Add a payment method before requesting your first ride.");
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Location is not available in this browser.");
      return;
    }

    setIsLoading(true);
    setError("");
    stopCarAnimation();
    expectingRideIdRef.current = null;
    setRidePhase("idle");
    setMapDriver(null);
    activeTrackedRideRef.current = null;
    setEtaToPickupSec(null);
    setDriverDistanceKm(null);
    setPassengerRoadPaths(null);

    try {
      await ensurePassengerSocketReady(passengerId);

      let pickupLat: number;
      let pickupLng: number;
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 18_000,
            maximumAge: 5_000
          });
        });
        pickupLat = position.coords.latitude;
        pickupLng = position.coords.longitude;
      } catch {
        // Dev fallback so ride requests still work when browser blocks GPS/HTTPS.
        pickupLat = -23.5505;
        pickupLng = -46.6333;
        pushFeed("Location fallback", "Using default pickup in Sao Paulo because GPS is unavailable.");
      }

      const dropoffLat = chosenDestination.lat;
      const dropoffLng = chosenDestination.lng;
      const syntheticStart = syntheticDriverStartNearPickup({ lat: pickupLat, lng: pickupLng });

      const legToPassenger = await fetchRoadRoute(
        [
          { lat: syntheticStart[0], lng: syntheticStart[1] },
          { lat: pickupLat, lng: pickupLng }
        ],
        { snapEnds: true }
      );
      const legToDest = await fetchRoadRoute(
        [
          { lat: pickupLat, lng: pickupLng },
          { lat: dropoffLat, lng: dropoffLng }
        ],
        { snapEnds: true }
      );

      if (!legToPassenger?.coordinates?.length || !legToDest?.coordinates?.length) {
        setError("Could not compute a driving route. Try another address or check your connection.");
        return;
      }

      setPassengerRoadPaths([legToPassenger.coordinates, legToDest.coordinates]);

      const passengerTuple: LatLngTuple = [pickupLat, pickupLng];
      const pickupTuple: LatLngTuple = [pickupLat, pickupLng];
      const dropTuple: LatLngTuple = [dropoffLat, dropoffLng];
      setMapPassenger(passengerTuple);
      setMapPickup(pickupTuple);
      setMapDropoff(dropTuple);

      const result = await createRide({
        passengerId,
        pickupLat,
        pickupLng,
        dropoffLat,
        dropoffLng,
        dropoffLabel: chosenDestination.label
      });
      const rideId = String((result as { id?: string }).id ?? "-");
      expectingRideIdRef.current = rideId;
      setRidePhase("searching");
      const est = (result as { price?: number }).price ?? 0;
      const line = `Ride ${rideId} | finding driver… | fare estimate ~$${est.toFixed(2)} (final when driver accepts)`;
      setRideResult(line);
      appendRideHistory({ id: rideId, summary: line });
      setRideHistoryTick((n) => n + 1);
      pushFeed("Ride Requested", "Broadcasting to online drivers…");
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Failed to request ride";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSetupPaymentMethod() {
    let passengerId: string | undefined = sessionUser?.id;
    if (!passengerId && isGuest && currentRole === "passenger") {
      passengerId = getOrCreateGuestPassengerId();
    }
    if (!passengerId) {
      setError("Sign in as passenger first.");
      return;
    }
    const number = cardNumberInput.replace(/\s+/g, "");
    const expiry = cardExpiryInput.trim();
    const cvv = cardCvvInput.trim();
    const holder = cardHolderInput.trim();
    if (!holder || number.length < 12 || !/^\d+$/.test(number) || !/^\d{2}\/\d{2}$/.test(expiry) || cvv.length < 3) {
      setError("Enter valid test card details (number, MM/YY, CVV, cardholder).");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const testNonce = `fake-card-${number.slice(-4)}-${expiry.replace("/", "")}-${cvv.slice(0, 4)}`;
      await setupPaymentMethod({
        passengerId,
        paymentMethodNonce: testNonce,
        email: sessionUser?.email
      });
      setPaymentConfigured(true);
      setCardNumberInput(TEST_PAYMENT_FIELD_DEFAULTS.number);
      setCardExpiryInput(TEST_PAYMENT_FIELD_DEFAULTS.expiry);
      setCardCvvInput(TEST_PAYMENT_FIELD_DEFAULTS.cvv);
      setCardHolderInput(TEST_PAYMENT_FIELD_DEFAULTS.holder);
      pushFeed("Payment ready", "Payment method saved. Charges run automatically at drop-off.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save payment method.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSetupDriverPayout() {
    let driverId: string | undefined = sessionUser?.id;
    if (!driverId && isGuest && currentRole === "driver") {
      driverId = getOrCreateGuestDriverId();
    }
    if (!driverId) {
      setError("Sign in as driver first.");
      return;
    }
    const accountHolder = payoutHolderInput.trim();
    const payoutDestination = payoutDestinationInput.trim();
    if (accountHolder.length < 2 || payoutDestination.length < 4) {
      setError("Enter payout holder and payout destination.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      await setupDriverPayout({ driverId, accountHolder, payoutDestination });
      setPayoutConfigured(true);
      setPayoutHolderInput(DRIVER_PAYOUT_FIELD_DEFAULTS.holder);
      setPayoutDestinationInput(DRIVER_PAYOUT_FIELD_DEFAULTS.destination);
      pushFeed("Payout ready", "Driver payout method saved (testing mode).");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save payout details.");
    } finally {
      setIsLoading(false);
    }
  }

  async function acceptPendingOffer() {
    const offer = pendingOffer;
    if (!offer) return;
    if (!payoutConfigured) {
      setError("Set your payout details before accepting rides.");
      return;
    }
    let driverId = sessionUser?.id;
    if (!driverId && isGuest && currentRole === "driver") {
      driverId = getOrCreateGuestDriverId();
    }
    if (!driverId) {
      setError("Missing driver id.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const driverName =
        sessionUser?.email?.split("@")[0] || (isGuest ? "Guest driver" : `Driver ${driverId.slice(0, 6)}`);
      const pickupTuple: [number, number] = [offer.pickup.lat, offer.pickup.lng];
      const dropTuple: [number, number] = [offer.dropoff.lat, offer.dropoff.lng];
      const start = await readCurrentPosition();
      if (!start) {
        setError("Location permission is required to accept rides and compute your route.");
        return;
      }

      const legToPickup = await fetchRoadRoute(
        [
          { lat: start[0], lng: start[1] },
          { lat: offer.pickup.lat, lng: offer.pickup.lng }
        ],
        { snapEnds: true }
      );
      const legToDrop = await fetchRoadRoute(
        [
          { lat: offer.pickup.lat, lng: offer.pickup.lng },
          { lat: offer.dropoff.lat, lng: offer.dropoff.lng }
        ],
        { snapEnds: true }
      );

      if (!legToPickup?.coordinates?.length || !legToDrop?.coordinates?.length) {
        setError("Routing failed — check your connection. You can retry accepting the next offer.");
        setPendingOffer(null);
        setDriverOfferRoadPaths(null);
        setDriverOfferPreviewKm(null);
        return;
      }

      const legMPickup =
        (legToPickup.distanceMeters ?? 0) > 1
          ? legToPickup.distanceMeters!
          : polylineLengthKm(legToPickup.coordinates) * 1000;
      const legMDrop =
        (legToDrop.distanceMeters ?? 0) > 1
          ? legToDrop.distanceMeters!
          : polylineLengthKm(legToDrop.coordinates) * 1000;
      const routedTotalKm = (legMPickup + legMDrop) / 1000;
      const acceptResponse = await acceptRide(offer.rideId, driverId, {
        driverName,
        routedDistanceKm: routedTotalKm,
        distanceToPickupKm: legMPickup / 1000,
        driverLat: start[0],
        driverLng: start[1]
      });
      const finalFare = acceptResponse && typeof acceptResponse === "object" ? (acceptResponse as { price?: number }).price : undefined;

      driverOfferRouteRequestIdRef.current += 1;
      setPendingOffer(null);
      setDriverOfferRoadPaths(null);
      setDriverOfferPreviewKm(null);
      const mergedRoad = appendRouteLegs(legToPickup.coordinates, legToDrop.coordinates);
      setDriverTripRoadPaths([mergedRoad]);

      setMapPassenger(pickupTuple);
      setMapPickup(pickupTuple);
      setMapDropoff(dropTuple);
      setMapDriver(start);
      setDriverDistanceKm(legMPickup / 1000);

      startRoadTripSimulation({
        rideId: offer.rideId,
        driverId,
        pickup: pickupTuple,
        legToPickup: legToPickup.coordinates,
        legPickupToDropoff: legToDrop.coordinates
      });
      setDriverMode("busy");
      setDriverActiveRideId(offer.rideId);

      pushFeed(
        "You accepted",
        finalFare !== undefined
          ? `Fare $${finalFare.toFixed(2)} (${routedTotalKm.toFixed(2)} km from your GPS) — navigating to pickup, then destination.`
          : `Ride ${offer.rideId.slice(0, 8)}… — navigating via roads to pickup, then drop-off.`
      );
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Could not accept — another driver may have taken it.";
      setError(message);
      setPendingOffer(null);
      setDriverOfferRoadPaths(null);
      setDriverOfferPreviewKm(null);
    } finally {
      setIsLoading(false);
    }
  }

  function rejectPendingOffer() {
    if (!pendingOffer) return;
    pushFeed("Offer dismissed", `You skipped ride ${pendingOffer.rideId.slice(0, 8)}…`);
    dismissDriverIncomingOfferMaps();
  }

  async function acceptPendingDeliveryOffer() {
    const offer = pendingDeliveryOffer;
    if (!offer) return;
    let driverId = sessionUser?.id;
    if (!driverId && isGuest && currentRole === "driver") {
      driverId = getOrCreateGuestDriverId();
    }
    if (!driverId) {
      setError("Missing driver id.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      await acceptDelivery(offer.deliveryId, { driverId });
      setDriverActiveDeliveryId(offer.deliveryId);
      setDriverMode("busy");
      const prev = driverDeliveryOfferRoadPaths;
      if (prev && (prev[0]?.length >= 2 || prev[1]?.length >= 2)) {
        setDriverActiveDeliveryRoadPaths(prev.map((leg) => (leg.length >= 2 ? [...leg] : [])));
      } else {
        setDriverActiveDeliveryRoadPaths(null);
      }
      setMapPickup([offer.restaurant.lat, offer.restaurant.lng]);
      setMapDropoff([offer.customer.lat, offer.customer.lng]);
      setMapPassenger(null);
      setPendingDeliveryOffer(null);
      setDeliveryOfferMetrics(null);
      setDriverDeliveryOfferRoadPaths(null);
      pushFeed("Delivery accepted", `Order ${offer.orderId.slice(0, 8)}… assigned — follow the route on the map.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept delivery.");
    } finally {
      setIsLoading(false);
    }
  }

  async function cancelDriverRideNow() {
    if (!driverActiveRideId) return;
    setIsLoading(true);
    setError("");
    try {
      await cancelRide(driverActiveRideId);
      stopDriveSimulation();
      setDriverMode("online");
      setDriverActiveRideId(null);
      setRidePhase("idle");
      setMapDriver(null);
      setMapPassenger(null);
      setMapPickup(null);
      setMapDropoff(null);
      setDriverTripRoadPaths(null);
      setEtaToPickupSec(null);
      setDriverDistanceKm(null);
      pushFeed("Ride canceled", "Driver canceled the current ride.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel ride.");
    } finally {
      setIsLoading(false);
    }
  }

  async function cancelPassengerRideNow() {
    const rideId = expectingRideIdRef.current;
    if (!rideId) return;
    const wasSearching = ridePhase === "searching";
    setIsLoading(true);
    setError("");
    try {
      await cancelRide(rideId);
      expectingRideIdRef.current = null;
      activeTrackedRideRef.current = null;
      setRidePhase("idle");
      setMapDriver(null);
      setMapPassenger(null);
      setMapPickup(null);
      setPassengerRoadPaths(null);
      setEtaToPickupSec(null);
      setDriverDistanceKm(null);
      setDriverOnWayLabel("");
      if (wasSearching) {
        setRideResult("Search canceled — you can request again.");
        pushFeed("Search canceled", "You stopped looking for a driver before anyone accepted.");
      } else {
        setRideResult("Ride canceled.");
        pushFeed("Ride canceled", "You canceled your current ride.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel ride.");
    } finally {
      setIsLoading(false);
    }
  }

  const offerCardDistances = pendingOffer
    ? {
        toPickupKm:
          driverOfferPreviewKm?.distanceToPickupKm ?? pendingOffer.distanceToPickupKm ?? null,
        routedTotalKm:
          driverOfferPreviewKm?.routedDistanceKm ?? pendingOffer.routedDistanceKm ?? null
      }
    : null;
  const offerCardPassengerLegKm =
    offerCardDistances?.toPickupKm != null && offerCardDistances.routedTotalKm != null
      ? Math.max(0, offerCardDistances.routedTotalKm - offerCardDistances.toPickupKm)
      : null;

  /** Great-circle distance (not drive distance) — used to explain missing OSRM leg when driver is on another continent. */
  const deliveryDriverToRestaurantKm =
    pendingDeliveryOffer && mapDriver
      ? haversineKm(mapDriver, [
          pendingDeliveryOffer.restaurant.lat,
          pendingDeliveryOffer.restaurant.lng
        ])
      : null;
  const deliveryPreviewFirstLegMissing =
    Boolean(pendingDeliveryOffer) &&
    (!driverDeliveryOfferRoadPaths?.[0] || driverDeliveryOfferRoadPaths[0].length < 2);

  /** Single driver-console map: avoids swapping the idle-map branch for offer-only UI (which hid the map). */
  const driverConsoleMapConfig = useMemo((): {
    mapKey: string;
    className: string;
    passenger: LatLngTuple | null;
    pickup: LatLngTuple;
    dropoff: LatLngTuple;
    variant: "ride" | "delivery";
    routePolylines: LatLngTuple[][] | undefined;
    routePolylineColors: readonly string[] | undefined;
  } | null => {
    if (pendingOffer) {
      return {
        mapKey: `ride-offer-${pendingOffer.rideId}`,
        className:
          "mt-3 h-[min(52vh,420px)] w-full overflow-hidden rounded-xl border border-neonGreen/40",
        passenger: [pendingOffer.pickup.lat, pendingOffer.pickup.lng],
        pickup: [pendingOffer.pickup.lat, pendingOffer.pickup.lng],
        dropoff: [pendingOffer.dropoff.lat, pendingOffer.dropoff.lng],
        variant: "ride",
        routePolylines: driverOfferRoadPaths ?? undefined,
        routePolylineColors: undefined
      };
    }
    if (pendingDeliveryOffer) {
      return {
        mapKey: `delivery-offer-${pendingDeliveryOffer.deliveryId}`,
        className:
          "mt-3 h-[min(52vh,420px)] w-full overflow-hidden rounded-xl border border-amber-500/45",
        passenger: null,
        pickup: [pendingDeliveryOffer.restaurant.lat, pendingDeliveryOffer.restaurant.lng],
        dropoff: [pendingDeliveryOffer.customer.lat, pendingDeliveryOffer.customer.lng],
        variant: "delivery",
        routePolylines: driverDeliveryOfferRoadPaths ?? undefined,
        routePolylineColors: ["#fbbf24", "#6366f1"]
      };
    }
    if (driverActiveDeliveryId && mapPickup && mapDropoff) {
      return {
        mapKey: `active-delivery-${driverActiveDeliveryId}`,
        className:
          "mt-3 h-[min(52vh,420px)] w-full overflow-hidden rounded-xl border border-amber-500/45",
        passenger: null,
        pickup: mapPickup,
        dropoff: mapDropoff,
        variant: "delivery",
        routePolylines: driverActiveDeliveryRoadPaths ?? undefined,
        routePolylineColors: ["#fbbf24", "#6366f1"]
      };
    }
    if (mapPassenger) {
      return {
        mapKey: "driver-idle-trip",
        className: "mt-3 h-[min(52vh,420px)] w-full overflow-hidden rounded-xl border border-[#263553]",
        passenger: mapPassenger,
        pickup: mapPickup ?? mapPassenger,
        dropoff: mapDropoff ?? mapPassenger,
        variant: "ride",
        routePolylines: driverTripRoadPaths ?? undefined,
        routePolylineColors: undefined
      };
    }
    return null;
  }, [
    pendingOffer,
    pendingDeliveryOffer,
    driverActiveDeliveryId,
    driverActiveDeliveryRoadPaths,
    mapPassenger,
    mapPickup,
    mapDropoff,
    driverOfferRoadPaths,
    driverDeliveryOfferRoadPaths,
    driverTripRoadPaths
  ]);

  return (
    <main className="min-h-screen bg-nexoBg">
      <header className="border-b border-electricBlue/35 bg-[#0f1524]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <NexoLogo width={132} height={36} />
          {isAuthenticated && (
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-electricBlue/50 bg-[#1a2336] text-slate-100 transition hover:border-electricBlue hover:bg-[#24314c]"
              aria-label="Open profile"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-5 w-5"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>
      </header>
      {isAuthenticated && locationGateOk && activeTab === "passenger" && !paymentConfigured && (
        <div className="z-20 border-b border-electricBlue/30 bg-[#0c1220] px-4 py-3 md:px-8">
          <div className="mx-auto w-full max-w-6xl rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-sm text-amber-100">
              Add your test credit card before requesting rides (Braintree sandbox mode).
            </p>
            {PREFILL_TEST_FORMS ? (
              <p className="mt-2 text-xs text-amber-200/80">
                Form is pre-filled with standard sandbox Visa digits - use{" "}
                <strong className="text-amber-100">Save test card</strong>.
              </p>
            ) : null}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                value={cardHolderInput}
                onChange={(e) => setCardHolderInput(e.target.value)}
                placeholder="Cardholder name"
                className="w-full rounded-xl border border-[#263553] bg-[#1a2336] px-3 py-2 text-sm text-slate-100"
              />
              <input
                value={cardNumberInput}
                onChange={(e) => setCardNumberInput(e.target.value)}
                placeholder="Card number (test)"
                className="w-full rounded-xl border border-[#263553] bg-[#1a2336] px-3 py-2 text-sm text-slate-100"
              />
              <input
                value={cardExpiryInput}
                onChange={(e) => setCardExpiryInput(e.target.value)}
                placeholder="MM/YY"
                className="w-full rounded-xl border border-[#263553] bg-[#1a2336] px-3 py-2 text-sm text-slate-100"
              />
              <input
                value={cardCvvInput}
                onChange={(e) => setCardCvvInput(e.target.value)}
                placeholder="CVV"
                className="w-full rounded-xl border border-[#263553] bg-[#1a2336] px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => void handleSetupPaymentMethod()}
                disabled={isLoading}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
              >
                Save test card
              </button>
            </div>
          </div>
        </div>
      )}
      {isAuthenticated && locationGateOk && activeTab === "passenger" && paymentConfigured && (
        <div className="z-20 border-b border-electricBlue/30 bg-[#0c1220] px-4 py-3 md:px-8">
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500" htmlFor="going-to-input">
            Going to
          </label>
          <div className="relative mt-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <input
                id="going-to-input"
                type="text"
                autoComplete="off"
                value={goingToInput}
                onChange={(e) => {
                  setGoingToInput(e.target.value);
                  if (chosenDestination) {
                    setChosenDestination(null);
                    setMapDropoff(null);
                    setPassengerRoadPaths(null);
                  }
                }}
                disabled={ridePhase === "searching"}
                placeholder="Search for an address or place"
                className="w-full rounded-xl border border-[#263553] bg-[#1a2336] px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 disabled:opacity-60"
              />
              {chosenDestination && ridePhase !== "searching" && (
                <button
                  type="button"
                  onClick={() => {
                    setChosenDestination(null);
                    setGoingToInput("");
                    setGoingToSuggestions([]);
                    setMapDropoff(null);
                    setPassengerRoadPaths(null);
                  }}
                  className="shrink-0 rounded-xl border border-electricBlue/40 px-3 py-2 text-sm text-electricBlue hover:bg-[#1a2336]"
                >
                  Clear destination
                </button>
              )}
            </div>
            {goingToSuggestions.length > 0 && ridePhase !== "searching" && (
              <ul
                className="absolute left-0 right-0 top-full z-30 mt-1 max-h-52 overflow-auto rounded-xl border border-[#263553] bg-[#101728] py-1 shadow-lg"
                role="listbox"
              >
                {goingToSuggestions.map((hit) => (
                  <li key={`${hit.lat}-${hit.lon}-${hit.display_name.slice(0, 40)}`}>
                    <button
                      type="button"
                      role="option"
                      className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-[#1a2336]"
                      onClick={() => {
                        const lat = Number.parseFloat(hit.lat);
                        const lng = Number.parseFloat(hit.lon);
                        if (Number.isNaN(lat) || Number.isNaN(lng)) return;
                        const short =
                          hit.display_name.split(",").slice(0, 2).join(",").trim() || hit.display_name;
                        setChosenDestination({ label: hit.display_name, lat, lng });
                        setGoingToInput(short);
                        setGoingToSuggestions([]);
                        setMapDropoff([lat, lng]);
                        setPassengerRoadPaths(null);
                      }}
                    >
                      {hit.display_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Pick a result to set your drop-off. The map shows your destination; we build the driving route when you
            request a ride.
          </p>
        </div>
      )}
      <div className="p-6 md:p-8">
      {!isAuthenticated ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto w-full max-w-xl rounded-3xl border border-electricBlue/40 bg-[#101728] p-5"
        >
          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setAuthMode("login")}
              className={`rounded-xl px-3 py-2 text-sm ${authMode === "login" ? "bg-electricBlue text-white" : "bg-[#1a2336]"}`}
            >
              Login
            </button>
            <button
              onClick={() => setAuthMode("signup")}
              className={`rounded-xl px-3 py-2 text-sm ${authMode === "signup" ? "bg-electricBlue text-white" : "bg-[#1a2336]"}`}
            >
              Sign Up
            </button>
          </div>

          <h2 className="text-xl font-semibold text-white">
            {authMode === "login" ? "Welcome back" : "Create your account"}
          </h2>

          <label className="mt-4 block text-xs text-slate-400">
            Email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@email.com"
              className="mt-1 w-full rounded-xl bg-[#1a2336] p-2 text-sm text-slate-100"
            />
          </label>
          <label className="mt-3 block text-xs text-slate-400">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              className="mt-1 w-full rounded-xl bg-[#1a2336] p-2 text-sm text-slate-100"
            />
          </label>

          <div className="mt-4">
            <p className="text-xs text-slate-400">
              {authMode === "signup" ? "Sign up as" : "Continue as"}
            </p>
            <div className="mt-2 flex gap-2">
              {(["passenger", "driver"] as const).map((role) => (
                <button
                  key={role}
                  onClick={() => setRoleChoice(role)}
                  className={`rounded-xl px-3 py-2 text-sm ${
                    roleChoice === role ? "bg-neonGreen text-black" : "bg-[#1a2336] text-slate-200"
                  }`}
                >
                  {role === "passenger" ? "Passenger" : "Driver"}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              onClick={loginOrSignUpWithEmail}
              disabled={isLoading}
              className="rounded-xl bg-electricBlue px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {authMode === "signup" ? "Sign Up with Email" : "Login with Email"}
            </button>
            <div className="flex flex-col gap-1">
              <div
                ref={googleButtonRef}
                className="flex min-h-[44px] min-w-[200px] max-w-[280px] items-center [&_iframe]:!max-w-[280px]"
              />
              {!googleReady && (
                <span className="text-xs text-slate-500">Loading Google sign-in…</span>
              )}
              <p className="text-xs text-slate-500">
                Continue with Google: first time creates your account; returning visitors sign in with the same email.
              </p>
            </div>
          </div>

          <div className="mt-5 border-t border-[#24314c] pt-4">
            <p className="text-xs text-slate-400">Try without signup</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => loginAsGuest("passenger")}
                className="rounded-xl bg-softPurple px-4 py-2 text-sm font-medium text-white"
              >
                Enter as Passenger Guest
              </button>
              <button
                onClick={() => loginAsGuest("driver")}
                className="rounded-xl bg-neonGreen px-4 py-2 text-sm font-medium text-black"
              >
                Enter as Driver Guest
              </button>
            </div>
          </div>

          {error && <p className="mt-4 rounded-xl bg-red-900/30 p-3 text-sm text-red-200">{error}</p>}
        </motion.div>
      ) : !locationGateOk ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto w-full max-w-xl rounded-3xl border border-electricBlue/40 bg-[#101728] p-6"
        >
          <h2 className="text-xl font-semibold text-white">Enable location</h2>
          <p className="mt-2 text-sm text-slate-300">
            Nexo uses your GPS for pickup, matching, and routing. Confirm access once to enter the app. Built‑in IDE
            browsers often block GPS; use an external Chrome / Firefox tab for real positioning.
          </p>
          {SKIP_LOCATION_GUARD_DEV ? (
            <button
              type="button"
              onClick={() => bypassLocationGateDevOnly()}
              className="mt-6 w-full rounded-xl border border-amber-500/55 bg-amber-500/15 px-4 py-3 text-sm font-semibold text-amber-50"
            >
              Continue without GPS (dev bypass)
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void requestLocationGateAccess()}
            className={`w-full rounded-xl bg-neonGreen px-4 py-3 text-sm font-semibold text-black ${SKIP_LOCATION_GUARD_DEV ? "mt-3" : "mt-6"}`}
          >
            Continue with location
          </button>
          {locationGateError ? (
            <p className="mt-4 rounded-xl bg-red-900/30 p-3 text-sm text-red-200">{locationGateError}</p>
          ) : null}
        </motion.div>
      ) : (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto grid w-full max-w-6xl gap-4 rounded-3xl border border-electricBlue/40 bg-[#101728] p-4 md:grid-cols-[1.4fr_1fr] md:p-6"
      >
        <section className="space-y-4">

          {activeTab === "passenger" && (
            <div className="space-y-4 rounded-2xl border border-neonGreen/35 bg-[#0f1524] p-4">
              <h2 className="text-lg font-semibold text-neonGreen">Ride</h2>
              {yammaBuyerOrderBanner ? (
                <div className="rounded-xl border border-neonGreen/50 bg-neonGreen/15 px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-neonGreen/90">Yamma order</p>
                  <p className="mt-1 text-sm text-slate-300">Order {yammaBuyerOrderBanner.orderId.slice(0, 8)}…</p>
                  <p className="mt-2 text-lg font-semibold text-white">{yammaBuyerOrderBanner.headline}</p>
                </div>
              ) : null}
              <p className="text-sm text-slate-300">
                We use your GPS for pickup, broadcast the trip to every online driver, then map the first driver who
                accepts (other offers disappear instantly).
              </p>
              <NexoRideMap
                className="h-[min(52vh,420px)] w-full overflow-hidden rounded-2xl border border-[#263553]"
                passenger={mapPassenger}
                pickup={mapPickup}
                dropoff={mapDropoff}
                driver={mapDriver}
                driverBearing={driverBearing}
                routePolylines={passengerRoadPaths ?? undefined}
              />
              <p className="text-xs text-slate-500">
                {ridePhase === "idle" &&
                  (chosenDestination
                    ? "Your destination is set. Request a ride to see the full driving route to drivers."
                    : "Choose where you’re going above; the flag shows your destination on the map.")}
                {ridePhase === "searching" && "Searching for a driver…"}
                {ridePhase === "matched" &&
                  "Driver matched — they follow road geometry to you, then continue to your drop-off (simulated live)."}
                {ridePhase === "completed" && "Trip completed — driver reached your destination."}
              </p>
              {etaToPickupSec !== null && (
                <p className="rounded-xl bg-[#1a2336] p-3 text-sm text-slate-200">
                  {driverOnWayLabel.startsWith("Heading") ? (
                    <>
                      Time to destination (est.):{" "}
                      <strong>{Math.max(1, Math.ceil(etaToPickupSec / 60))} min</strong>
                    </>
                  ) : (
                    <>
                      Driver arrival (pickup, est.):{" "}
                      <strong>{Math.max(1, Math.ceil(etaToPickupSec / 60))} min</strong>
                    </>
                  )}
                </p>
              )}
              {driverOnWayLabel && (
                <p className="rounded-xl bg-neonGreen/20 p-3 text-sm font-semibold text-neonGreen">
                  {driverOnWayLabel}
                </p>
              )}
              {ridePhase === "matched" ? (
                <button
                  onClick={() => void cancelPassengerRideNow()}
                  disabled={isLoading}
                  className="w-full rounded-xl bg-red-600 px-6 py-2 font-medium text-white disabled:opacity-50"
                >
                  {isLoading ? "Cancelling…" : "Cancel ride"}
                </button>
              ) : null}
              {ridePhase === "searching" ? (
                <button
                  type="button"
                  onClick={() => void cancelPassengerRideNow()}
                  disabled={isLoading}
                  className="w-full rounded-xl border border-red-500/55 bg-red-900/25 px-6 py-2 font-medium text-red-50 disabled:opacity-50"
                >
                  {isLoading ? "Cancelling…" : "Stop search"}
                </button>
              ) : null}
              {chosenDestination && ridePhase !== "matched" ? (
                <button
                  type="button"
                  onClick={() => void handleRideRequest()}
                  disabled={isLoading || ridePhase === "searching" || !paymentConfigured}
                  className="w-full rounded-xl bg-electricBlue px-6 py-2 font-medium text-white disabled:opacity-50"
                >
                  {isLoading ? "Locating…" : ridePhase === "searching" ? "Searching for drivers…" : "Request ride"}
                </button>
              ) : ridePhase === "idle" ? (
                <p className="rounded-xl bg-[#1a2336] px-4 py-3 text-center text-sm text-slate-400">
                  {paymentConfigured ? (
                    <>
                      Choose a destination in <strong className="text-slate-200">Going to</strong> to enable{" "}
                      <strong className="text-slate-200">Request ride</strong>.
                    </>
                  ) : (
                    <>
                      Save your test card above to unlock <strong className="text-slate-200">Going to</strong> and{" "}
                      <strong className="text-slate-200">Request ride</strong>.
                    </>
                  )}
                </p>
              ) : null}
              <p className="rounded-xl bg-[#1a2336] p-3 text-sm text-slate-100">{rideResult}</p>
            </div>
          )}

          {activeTab === "driver" && (
            <div className="space-y-4 rounded-2xl border border-softPurple/35 bg-[#0f1524] p-4">
              <h2 className="text-lg font-semibold text-softPurple">Driver Console</h2>
              <div className="flex gap-2">
                {(["offline", "online", "busy"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setDriverMode(mode);
                      pushFeed("Driver Mode Changed", `Driver is now ${mode}`);
                    }}
                    className={`rounded-xl px-3 py-2 text-sm ${
                      driverMode === mode ? "bg-softPurple text-white" : "bg-[#1a2336] text-slate-200"
                    }`}
                  >
                    {mode.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="rounded-xl bg-[#1a2336] p-3 text-sm text-slate-100">
                Active state: <strong>{driverMode}</strong>
              </div>
              <p className="text-xs text-slate-500">
                Go <strong>ONLINE</strong> and open a second window as a passenger to test matching. First accept wins;
                other drivers see the offer vanish.
              </p>
              {!payoutConfigured && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="text-sm text-amber-100">
                    Add payout details before accepting rides (testing mode).
                  </p>
                  {PREFILL_TEST_FORMS ? (
                    <p className="mt-2 text-xs text-amber-200/80">
                      Fields use sample payout data — tap <strong className="text-amber-100">Save payout</strong>.
                    </p>
                  ) : null}
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input
                      value={payoutHolderInput}
                      onChange={(e) => setPayoutHolderInput(e.target.value)}
                      placeholder="Account holder"
                      className="w-full rounded-xl border border-[#263553] bg-[#1a2336] px-3 py-2 text-sm text-slate-100"
                    />
                    <input
                      value={payoutDestinationInput}
                      onChange={(e) => setPayoutDestinationInput(e.target.value)}
                      placeholder="Payout destination (email / PIX / phone)"
                      className="w-full rounded-xl border border-[#263553] bg-[#1a2336] px-3 py-2 text-sm text-slate-100"
                    />
                  </div>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => void handleSetupDriverPayout()}
                      disabled={isLoading}
                      className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
                    >
                      Save payout
                    </button>
                  </div>
                </div>
              )}
              {pendingOffer ? (
                <>
                  <div className="mt-3 rounded-xl border border-neonGreen/40 bg-[#122235] p-4">
                    <p className="text-sm font-semibold text-neonGreen">New ride request</p>
                    <p className="mt-2 text-sm text-slate-100">
                      To pickup (road):{" "}
                      <strong>
                        {offerCardDistances?.toPickupKm != null
                          ? `${(offerCardDistances.toPickupKm * KM_TO_MI).toFixed(2)} mi `
                          : driverDistanceKm !== null
                            ? `${(driverDistanceKm * KM_TO_MI).toFixed(2)} mi `
                            : "…"}
                      </strong>
                      {offerCardDistances?.toPickupKm != null || driverDistanceKm !== null ? (
                        <span className="font-normal text-slate-400">
                          (
                          {offerCardDistances?.toPickupKm != null
                            ? `${offerCardDistances.toPickupKm.toFixed(2)} km`
                            : `${driverDistanceKm!.toFixed(2)} km`}
                          )
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-sm text-slate-100">
                      Pickup → destination (road):{" "}
                      <strong>
                        {offerCardPassengerLegKm != null
                          ? `${(offerCardPassengerLegKm * KM_TO_MI).toFixed(2)} mi `
                          : "…"}
                      </strong>
                      {offerCardPassengerLegKm != null ? (
                        <span className="font-normal text-slate-400">({offerCardPassengerLegKm.toFixed(2)} km)</span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-sm text-slate-100">
                      Full trip (road):{" "}
                      <strong>
                        {offerCardDistances?.routedTotalKm != null
                          ? `${(offerCardDistances.routedTotalKm * KM_TO_MI).toFixed(2)} mi `
                          : "…"}
                      </strong>
                      {offerCardDistances?.routedTotalKm != null ? (
                        <span className="font-normal text-slate-400">
                          ({offerCardDistances.routedTotalKm.toFixed(2)} km)
                        </span>
                      ) : null}
                    </p>
                    {typeof pendingOffer.price === "number" && Number.isFinite(pendingOffer.price) ? (
                      <p className="mt-2 text-base text-neonGreen/95">
                        Offered fare:{" "}
                        <strong>{new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(pendingOffer.price)}</strong>
                      </p>
                    ) : null}
                    {pendingOffer.dropoffLabel && (
                      <p className="mt-1 text-xs text-slate-400">Passenger destination: {pendingOffer.dropoffLabel}</p>
                    )}
                    {etaToPickupSec !== null && (
                      <p className="mt-2 text-sm text-slate-200">
                        Arrival estimate: <strong>{Math.max(1, Math.ceil(etaToPickupSec / 60))} min</strong>
                      </p>
                    )}
                    <p className="mt-1 text-sm text-slate-300">
                      Fare preview uses a provisional route. When you accept, we lock fare from your live GPS path to pickup
                      and drop-off.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => void acceptPendingOffer()}
                        disabled={isLoading || !payoutConfigured}
                        className="rounded-xl bg-neonGreen px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
                      >
                        Accept ride
                      </button>
                      <button
                        onClick={rejectPendingOffer}
                        className="rounded-xl bg-[#2a3754] px-4 py-2 text-sm font-medium text-white"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                  {driverConsoleMapConfig ? (
                    <NexoRideMap
                      key={driverConsoleMapConfig.mapKey}
                      className={driverConsoleMapConfig.className}
                      passenger={driverConsoleMapConfig.passenger}
                      pickup={driverConsoleMapConfig.pickup}
                      dropoff={driverConsoleMapConfig.dropoff}
                      variant={driverConsoleMapConfig.variant}
                      driver={mapDriver}
                      driverBearing={driverBearing}
                      routePolylines={driverConsoleMapConfig.routePolylines}
                      routePolylineColors={driverConsoleMapConfig.routePolylineColors}
                      driverMarkerTitle="You"
                    />
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">
                      Waiting for GPS or routing preview… open location permissions to see the map.
                    </p>
                  )}
                </>
              ) : pendingDeliveryOffer ? (
                <>
                  <div className="mt-3 rounded-xl border border-amber-400/45 bg-[#221b12] p-4">
                    <p className="text-sm font-semibold text-amber-200">New delivery request</p>
                    <p className="mt-1 text-xs text-slate-300">
                      Order: <strong>{pendingDeliveryOffer.orderId.slice(0, 8)}…</strong>
                    </p>
                    {deliveryOfferMetrics ? (
                      <>
                        <p className="mt-2 text-sm text-slate-100">
                          Your location → restaurant:{" "}
                          <strong>{deliveryOfferMetrics.toRestaurantMi.toFixed(2)} mi</strong>
                        </p>
                        <p className="mt-1 text-sm text-slate-100">
                          Restaurant → buyer:{" "}
                          <strong>{deliveryOfferMetrics.toCustomerMi.toFixed(2)} mi</strong>
                        </p>
                        <p className="mt-1 text-sm text-slate-100">
                          Total trip: <strong>{deliveryOfferMetrics.totalMi.toFixed(2)} mi</strong>
                        </p>
                        <p className="mt-2 text-base text-amber-100">
                          Est. payout (demo):{" "}
                          <strong>
                            {new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(
                              deliveryOfferMetrics.estimatedPayoutUsd
                            )}
                          </strong>
                        </p>
                        {!driverDeliveryOfferRoadPaths ? (
                          <p className="mt-2 text-xs text-amber-200/90">
                            Routing didn’t return roads for this preview (retry or check the network). The map shows pins only. Estimated miles below may blend road + straight‑line distances.
                          </p>
                        ) : deliveryPreviewFirstLegMissing &&
                          mapDriver &&
                          deliveryDriverToRestaurantKm != null &&
                          deliveryDriverToRestaurantKm > 400 ? (
                          <p className="mt-2 text-xs text-amber-200/95">
                            The amber line is hidden because there is no driving route between your GPS and the restaurant (
                            ~{Math.round(deliveryDriverToRestaurantKm).toLocaleString()} km apart). OSRM only draws
                            real roads; Rio→Washington-style distances cannot connect. Test with driver and restaurant in
                            the same metro to see both legs.
                          </p>
                        ) : deliveryPreviewFirstLegMissing ? (
                          <p className="mt-2 text-xs text-amber-200/90">
                            Couldn’t load road directions for you → restaurant (retry or check the network). Restaurant →
                            buyer may still show if that leg routes successfully.
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-slate-400">Calculating distance and payout…</p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-1 w-6 rounded bg-amber-400" aria-hidden />
                        You → restaurant
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-1 w-6 rounded bg-indigo-400" aria-hidden />
                        Restaurant → buyer
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">
                      Map below shows the route to the restaurant, then to the buyer. You are the blue car marker.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => void acceptPendingDeliveryOffer()}
                        disabled={isLoading}
                        className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
                      >
                        Accept delivery
                      </button>
                      <button
                        onClick={dismissDriverIncomingDeliveryOffer}
                        className="rounded-xl bg-[#2a3754] px-4 py-2 text-sm font-medium text-white"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                  {driverConsoleMapConfig ? (
                    <NexoRideMap
                      key={driverConsoleMapConfig.mapKey}
                      className={driverConsoleMapConfig.className}
                      passenger={driverConsoleMapConfig.passenger}
                      pickup={driverConsoleMapConfig.pickup}
                      dropoff={driverConsoleMapConfig.dropoff}
                      variant={driverConsoleMapConfig.variant}
                      driver={mapDriver}
                      driverBearing={driverBearing}
                      routePolylines={driverConsoleMapConfig.routePolylines}
                      routePolylineColors={driverConsoleMapConfig.routePolylineColors}
                      driverMarkerTitle="You"
                    />
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">
                      Waiting for GPS or routing preview… open location permissions to see the map.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-3 text-sm text-slate-500">
                    {driverMode === "online"
                      ? "Listening for passengers and deliveries…"
                      : "Switch to ONLINE to receive ride offers."}
                  </p>
                  {driverActiveRideId && (
                    <button
                      type="button"
                      onClick={() => void cancelDriverRideNow()}
                      disabled={isLoading}
                      className="mt-3 w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {isLoading ? "Cancelling…" : "Cancel ride"}
                    </button>
                  )}
                  {driverConsoleMapConfig ? (
                    <NexoRideMap
                      key={driverConsoleMapConfig.mapKey}
                      className={driverConsoleMapConfig.className}
                      passenger={driverConsoleMapConfig.passenger}
                      pickup={driverConsoleMapConfig.pickup}
                      dropoff={driverConsoleMapConfig.dropoff}
                      variant={driverConsoleMapConfig.variant}
                      driver={mapDriver}
                      driverBearing={driverBearing}
                      routePolylines={driverConsoleMapConfig.routePolylines}
                      routePolylineColors={driverConsoleMapConfig.routePolylineColors}
                      driverMarkerTitle="You"
                    />
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">
                      {driverMode === "online"
                        ? "Waiting for GPS or trip preview… open location permissions to see the map."
                        : "Switch to ONLINE to receive offers."}
                    </p>
                  )}
                </>
              )}
              {driverActiveDeliveryId && (
                <p className="mt-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  Active delivery — follow the amber and indigo routes on the map. Your position updates automatically while
                  GPS is on.
                </p>
              )}
              {currentRole === "driver" && etaToPickupSec !== null && (
                <p className="rounded-xl bg-[#1a2336] p-3 text-sm text-slate-200">
                  Time left on current road segment (est.):{" "}
                  <strong>{Math.max(1, Math.ceil(etaToPickupSec / 60))} min</strong>
                </p>
              )}
            </div>
          )}

          {activeTab === "admin" && (
            <div className="space-y-4 rounded-2xl border border-electricBlue/35 bg-[#0f1524] p-4">
              <h2 className="text-lg font-semibold text-electricBlue">Admin Monitor</h2>
              <div className="grid gap-3 md:grid-cols-3">
                <StatCard label="Active Drivers" value={driverMode === "online" ? "1" : "0"} />
                <StatCard label="Live Rides" value={rideResult.includes("Ride") ? "1" : "0"} />
                <StatCard label="Open Driver Offers" value={pendingOffer ? "1" : "0"} />
                <StatCard label="Open Delivery Offers" value={pendingDeliveryOffer ? "1" : "0"} />
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4 rounded-2xl border border-electricBlue/35 bg-[#0f1524] p-4">
          <h3 className="text-lg font-semibold text-electricBlue">Realtime Activity</h3>
          {error && <p className="rounded-xl bg-red-900/30 p-3 text-sm text-red-200">{error}</p>}
          {feed.length === 0 ? (
            <p className="text-sm text-slate-300">No events yet. Trigger a ride or delivery action.</p>
          ) : (
            <ul className="space-y-2">
              {feed.map((item) => (
                <li key={item.id} className="rounded-xl bg-[#1a2336] p-3">
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="text-xs text-slate-300">{item.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </motion.div>
      )}
      </div>

      {portalMounted &&
        profileOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/55 p-4 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-title"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setProfileOpen(false);
            }}
          >
          <div className="relative z-[10001] max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-electricBlue/40 bg-[#101728] p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h2 id="profile-title" className="text-lg font-semibold text-white">
                Your profile
              </h2>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-[#1a2336] hover:text-white"
                onClick={() => setProfileOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="mt-4 rounded-xl bg-[#1a2336] p-4 text-sm text-slate-200">
              {isGuest ? (
                <>
                  <p className="font-medium text-neonGreen">Guest</p>
                  <p className="mt-1 text-slate-400">
                    Signed in locally as{" "}
                    <span className="text-slate-200">{currentRole}</span>. Request rides as a passenger
                    guest, or create an account to sync across devices.
                  </p>
                </>
              ) : sessionUser ? (
                <>
                  <p className="font-semibold text-white">{sessionUser.email}</p>
                  <p className="mt-2 text-slate-400">
                    Role: <span className="text-slate-200">{sessionUser.role}</span>
                  </p>
                  <p className="mt-1 text-slate-400">
                    Signed in with <span className="text-slate-200">{sessionUser.provider}</span>
                  </p>
                </>
              ) : (
                <p className="text-slate-400">Loading profile…</p>
              )}
            </div>

            <div className="mt-5">
              <h3 className="text-sm font-semibold text-electricBlue">Your rides (this device)</h3>
              {(() => {
                void rideHistoryTick;
                const rides = loadRideHistory();
                return rides.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">No rides yet. Request one from the passenger tab.</p>
                ) : (
                  <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
                    {rides.map((r) => (
                      <li key={`${r.id}-${r.createdAt}`} className="rounded-lg bg-[#1a2336] p-3 text-xs text-slate-300">
                        <p className="font-mono text-[11px] text-slate-500">{r.createdAt}</p>
                        <p className="mt-1 text-slate-200">{r.summary}</p>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>

            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-xl border border-electricBlue/50 bg-[#1a2336] py-2.5 text-sm font-medium text-white hover:bg-[#24314c]"
              >
                Log out
              </button>
              {!isGuest && loadStoredToken() && (
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={isLoading}
                  className="rounded-xl border border-red-500/50 bg-red-950/40 py-2.5 text-sm font-medium text-red-200 hover:bg-red-950/60 disabled:opacity-50"
                >
                  Delete account
                </button>
              )}
            </div>
          </div>
        </div>,
          document.body
        )}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#1a2336] p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-white">{value}</p>
    </div>
  );
}
