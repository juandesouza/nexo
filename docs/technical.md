# Technical Specifications

## Core Stack

- TypeScript across all packages
- `backend`: NestJS, Prisma, Redis, Socket.IO
- `web`: Next.js App Router, Tailwind CSS, Zustand, TanStack Query, Framer Motion
- `mobile`: Expo SDK 54, Expo Router, Reanimated, Gesture Handler, Zustand
- `design-system`: shared tokens + reusable primitive UI components

## Environment Contracts

### Backend
- `PORT`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `PUBLIC_RESET_URL`
- `GOOGLE_OAUTH_WEB_CLIENT_ID`
- `GOOGLE_OAUTH_MOBILE_CLIENT_ID`

### Web
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_BACKEND_VERSION`
- `NEXT_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID`

### Mobile
- `EXPO_PUBLIC_API_BASE_URL` (must be https)
- `EXPO_PUBLIC_BACKEND_VERSION`
- `EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID`

## State Machines

Ride:
- `requested`
- `accepted`
- `driver_arriving`
- `in_progress`
- `completed`
- `canceled`

Delivery:
- `requested`
- `accepted`
- `going_to_restaurant`
- `picked_up`
- `delivering`
- `delivered`
