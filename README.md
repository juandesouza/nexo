# NEXO Super App

NEXO is a full-stack ride-hailing and delivery platform with:
- Ride flows (Uber-like)
- Delivery integration hooks for Yamma
- Real-time tracking and status updates
- Shared design system across web and mobile

## Monorepo

- `web`: Next.js App Router admin and web clients
- `mobile`: Expo Router app for passenger and driver flows
- `backend`: NestJS API, WebSockets, Prisma, Redis
- `design-system`: shared tokens and UI primitives

## Quick Start

1. Install dependencies:
   - `pnpm install`
2. Configure environment:
   - copy each `*.env.example` to `.env` per package
3. Start services:
   - `pnpm dev:backend`
   - `pnpm dev:web`
   - `pnpm dev:mobile` (Metro on LAN; scan QR with **Expo Go**)

## Expo Go (physical phone)

1. Install **Expo Go** from the App Store or Play Store (use a build that supports **SDK 54**).
2. Copy `mobile/.env.example` → `mobile/.env` and set **`EXPO_PUBLIC_API_BASE_URL`** to a URL your **phone** can reach:
   - Same Wi‑Fi as your PC: `http://<PC-LAN-IP>:4000` (not `localhost` — on the phone that means the phone itself). On Linux you can use `hostname -I` to pick your LAN address.
3. Start the API: `pnpm dev:backend` (default port **4000**).
4. Start Metro for Expo Go: `pnpm dev:mobile:go` (opens with **`-g` / Expo Go**). Or `pnpm dev:mobile` and press **`g`** in the terminal to switch to Expo Go, then scan the QR code.
5. If LAN or QR fails (guest Wi‑Fi, VPN, etc.), use `pnpm dev:mobile:tunnel` for Metro and point **`EXPO_PUBLIC_API_BASE_URL`** at a public **HTTPS** tunnel to Nest (for example ngrok) so fetches from the phone succeed.

## Notes

- Mobile uses **`http://` in development** (LAN or localhost); use HTTPS for production APIs.
- Expo SDK is **54**; keep the **Expo Go** app updated so its SDK matches the project.
- The shared UI package exposes a minimal mobile entry point to avoid web-only imports in mobile critical paths.
