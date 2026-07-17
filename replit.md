# Project Overview

This project was imported from [Lovable](https://lovable.dev). It's "Godson" — a status/notes app for tech founders: users sign in with Google, write short notes with a background, export them as 1080×1920 cards (for WhatsApp Status), and can publish to a public feed ("The Ledger").

## Stack

- **Framework:** TanStack Start (React 19) + Vite, SSR via a Nitro build
- **Styling:** Tailwind CSS v4 + custom luxury design system (off-black palette, glassmorphism utilities)
- **Backend/data:** Supabase (Postgres + Auth), project ref in `.env` / Replit env vars
- **Auth:** Lovable Cloud Auth (`@lovable.dev/cloud-auth-js`) wrapping Supabase, Google/GitHub/X sign-in
- **Package manager:** Bun (`bun.lock` is the source of truth)

## Running on Replit

- Dev server: `bun run dev` (runs `vite dev`), bound to the "Start application" workflow on port 5000.
- `vite.config.ts` sets `vite.server.host/port/allowedHosts` explicitly — the `@lovable.dev/vite-tanstack-config` preset defaults to `host: "::"`, `port: 8080` outside of Lovable's own sandbox, which doesn't work with Replit's proxy, so this override is required for the app to be visible in the Replit preview. Do not remove it.
- Supabase keys were already present in the imported `.env`; no new secrets were needed.

## User preferences

None recorded yet.
