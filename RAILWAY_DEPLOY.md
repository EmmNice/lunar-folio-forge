# Deploying The Ledger to Railway

## One-time setup

1. **Create a Railway project** and connect this GitHub repo.
2. **Set the following environment variables** in Railway → your service → Variables:

### Required vars

| Variable | Value / Where to get it |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API → `anon public` key |
| `VITE_SUPABASE_URL` | Same as `SUPABASE_URL` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Same as `SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key (keep secret) |
| `VITE_ADMIN_IDS` | Comma-separated Supabase user UUIDs for super-admins |
| `SESSION_SECRET` | Any long random string (32+ chars) |

### Admin domain gating

| Variable | Example | Purpose |
|---|---|---|
| `VITE_ADMIN_DOMAIN` | `admin.yourapp.com` | Only this hostname can reach `/admin`. Leave unset in dev to disable the gate. |

## Custom domains (Railway)

Add **two** custom domains to your single Railway service:

- `app.yourapp.com` — user-facing app (cannot reach `/admin`)
- `admin.yourapp.com` — admin-only (can reach `/admin`)

Both point to the same deployment. The `VITE_ADMIN_DOMAIN` env var is what separates them.

## How the build works

- **Build**: `bun install && bun run build`
  - Vite + TanStack Start + Nitro → outputs to `.output/`
  - Nitro preset: `node-server` (standard Node.js HTTP server)
- **Start**: `bun .output/server/index.mjs`
  - Listens on `PORT` env var (Railway injects this automatically)
  - Serves static assets from `.output/public/`

## Supabase RLS fix (required if not done yet)

Run `supabase/migrations/20260717_fix_rls_has_role_arg_order.sql`
in **Supabase Dashboard → SQL Editor** before deploying to fix a broken
admin RLS policy in the V2 migration.
