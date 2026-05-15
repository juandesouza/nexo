# Architecture

## High-Level

NEXO uses a feature-modular backend and shared design primitives:

- `web` (Next.js) for admin and browser clients
- `mobile` (Expo Router) for passenger and driver experiences
- `backend` (NestJS) as API + websocket realtime hub
- `design-system` shared visual tokens/components

## Data and Realtime

- PostgreSQL + Prisma for persistent entities
- Redis for live driver locations and ride matching candidates
- WebSockets for location and state transition events

## Module Boundaries

Backend modules are feature-first:
- `auth`
- `rides`
- `deliveries`
- `drivers`
- `matching`
- `payments`
- `ratings`
- `realtime`
- `admin`
- `yamma` integration gateway

Each module follows:
- Controller (input/output contracts)
- Service (business logic)
- Repository (persistence and data access)
- DTOs with validation

## Frontend Data Flow

- TanStack Query for server state
- Zustand for local client session/gameplay state
- Shared theme/tokens from `design-system`

## Security and Networking

- JWT auth with role claims (`passenger`, `driver`, `admin`)
- OTP-first phone auth entry point
- HTTPS-only API URL in mobile env validation
- No localhost/LAN fallback in mobile runtime
