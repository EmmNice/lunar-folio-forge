# The Ledger

A social network for Web3 builders, founders, and investors. Members write short
status cards, export them as 1080×1920 images, and publish to a single global
timeline — there is no follower graph.

## Features

- **Global feed** with two views: _Signal_ (text posts) and _Beat_ (Studio cards).
- **Studio** — compose a card, pick a theme, export a 1080×1920 PNG.
- **PulseAssist** — OpenAI-backed drafting and chat, metered by daily credits.
- **Verification** — Silver (builder) and Gold (investor) tracks with admin review.
- **Gated DMs** — 3 new conversations per day; Gold members also receive
  rate-limited inbound pitches.
- **Privacy controls** — post visibility, comment toggles, DM restriction,
  and opting out of search-engine indexing.

## Stack

|                 |                                                         |
| --------------- | ------------------------------------------------------- |
| Framework       | TanStack Start (React 19) + Vite                        |
| Styling         | Tailwind CSS v4, shadcn/ui (Radix)                      |
| Backend         | Supabase — Postgres, Row-Level Security, Auth, Realtime |
| Package manager | Bun (`bun.lock` is the source of truth)                 |
| Hosting         | Railway (Nitro `node-server` preset)                    |

## Getting started

```sh
bun install
cp .env.example .env    # then fill in your Supabase values
supabase db push        # apply migrations
bun run dev             # http://localhost:5000
```

| Script            |                                  |
| ----------------- | -------------------------------- |
| `bun run dev`     | Dev server on port 5000          |
| `bun run build`   | Production build into `.output/` |
| `bun run preview` | Serve the production build       |
| `bun run lint`    | ESLint + Prettier check          |
| `bun run format`  | Apply Prettier                   |

Environment variables are documented in [`.env.example`](.env.example);
deployment specifics are in [`RAILWAY_DEPLOY.md`](RAILWAY_DEPLOY.md).

## Architecture notes

**Authorization is RLS-first.** The browser talks to Postgres directly with the
anon key for most reads and writes. Server functions exist only where a policy
can't express the rule — daily quotas, admin review, and AI credit metering.

**Three Supabase clients, three trust levels.** Mixing them up is the easiest way
to introduce a hole here:

| Module                                     | Key                        | RLS                            |
| ------------------------------------------ | -------------------------- | ------------------------------ |
| `integrations/supabase/client.ts`          | publishable                | enforced as the signed-in user |
| `integrations/supabase/auth-middleware.ts` | publishable + caller's JWT | enforced as the caller         |
| `integrations/supabase/client.server.ts`   | service role               | **bypassed**                   |

`client.server.ts` must only ever be reached through a lazy
`await import(...)` from inside a server function handler. `*.functions.ts` files
are part of the client graph, so a top-level import would ship the service-role
key to the browser. The same applies to the other `*.server.ts` modules.

**Privileged profile columns are trigger-protected.** `verification_tier`,
`subscription_status`, and the AI credit counters cannot be written by the owner
of the row — RLS can't express per-column rules, so a `BEFORE UPDATE` trigger
rejects those changes. Tiers are set by verification review; credits by
`consume_ai_credit()`.

**Rate limits are enforced in SQL.** `consume_ai_credit()` and
`claim_conversation_slot()` check and increment in a single statement so parallel
requests can't overshoot a cap.

**Admin access** comes from a row in `public.user_roles`, re-checked server-side on
every privileged call. `VITE_ADMIN_DOMAIN` only restricts which hostname serves
the panel; it is not the security boundary.

There are two admin helpers, and the distinction matters:

|                            | Scope                                   | Granted to                      |
| -------------------------- | --------------------------------------- | ------------------------------- |
| `is_admin()`               | "am _I_ an admin?" — reads `auth.uid()` | `authenticated`, `service_role` |
| `has_role(uuid, app_role)` | any user, any role                      | `service_role` only             |

RLS policies and the server functions use `is_admin()`, because a policy
expression runs with the _caller's_ privileges — calling the service-role-only
`has_role()` from a policy raises `42501` for ordinary users. `has_role()` stays
locked down so members cannot probe who the admins are.

## Project layout

```
src/
  components/      Shared UI; components/ui is shadcn primitives
  hooks/           use-auth (session + profile), use-card-export (PNG export)
  integrations/    Supabase clients, auth middleware, generated types
  lib/             Server functions (*.functions.ts), shared config, helpers
  routes/          File-based routes; _authenticated/* sits behind the auth guard
supabase/
  migrations/      Applied in filename order; each is safe to re-run
```

`src/routeTree.gen.ts` is generated — don't edit it by hand.

Shared constants live in `src/lib/limits.ts`. Change a cap there rather than at
the call site, since client and server both read from it.
