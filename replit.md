# The Ledger — Project Overview

A premium social network for Web3 builders, founders, and investors. Users sign in via GitHub, Google, or X (Twitter), create short status cards, export them as 1080×1920 images (WhatsApp-ready), and publish to a global feed. Verified members (Silver / Gold tiers) get higher feed visibility.

Originally built on [Lovable](https://lovable.dev), now running on Replit.

## Stack

- **Framework:** TanStack Start (React 19) + Vite, SSR entry via `src/server.ts`
- **Styling:** Tailwind CSS v4 + shadcn/ui (Radix primitives), dark noir design system
- **Backend / data:** Supabase (Postgres + Row-Level Security + Auth + Realtime)
- **Auth:** Supabase OAuth — GitHub, Google, X — plus email magic link
- **Package manager:** Bun (`bun.lock` is the source of truth; use `bun install` / `bun add`)

## Key pages

| Route | What it does |
|---|---|
| `/` | Landing + sign-in |
| `/feed` | Global timeline — "Signal" (verified only) + "Beat" (all) tabs |
| `/u/:handle` | Public profile with status cards |
| `/_authenticated/onboarding` | Required first-time profile setup |
| `/_authenticated/studio` | Card creator — pick theme, write, export image |
| `/_authenticated/pulse` | PulseAssist — AI chat to draft posts |
| `/_authenticated/messages` | DM inbox and threads |
| `/_authenticated/notifications` | Activity feed |
| `/_authenticated/settings` | Privacy, notification prefs, pitch limits |
| `/_authenticated/admin` | Verification review + member tier management |

## Database

Supabase project: `pkojaxknaswxoprrjbly`  
Migrations live in `supabase/migrations/`. Key tables: `profiles`, `posts`, `verification_requests`, `conversations`, `messages`, `notifications`, `pitches`, `likes`, `comments`.

## Running on Replit

- Dev server: `bun run dev` — starts Vite on port 5000, bound to the "Start application" workflow.
- `vite.config.ts` explicitly sets `host: "0.0.0.0"`, `port: 5000`, `allowedHosts: true` so the Replit preview proxy can reach the server. Do not remove this.
- Required env vars (already set in Replit): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_ADMIN_IDS`

## User preferences

None recorded yet.
