# Deploying The Ledger to Railway

## One-time setup

1. **Create a Railway project** and connect this GitHub repo.
2. **Set the environment variables** below in Railway → your service → Variables.
3. **Apply the database migrations** (see [Database](#database)).

See [`.env.example`](.env.example) for the full annotated list.

### Required

| Variable                        | Value / where to get it                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                  | Supabase → Project Settings → API → Project URL                                                            |
| `SUPABASE_PUBLISHABLE_KEY`      | Supabase → Settings → API Keys → publishable key (`sb_publishable_…`)                                      |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → Settings → API Keys → secret key (`sb_secret_…`) — keep secret                                  |
| `VITE_SUPABASE_URL`             | Same value as `SUPABASE_URL`                                                                               |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Same value as `SUPABASE_PUBLISHABLE_KEY`                                                                   |
| `APP_URL`                       | Public base URL of this deployment, e.g. `https://app.yourapp.com`. Used for links in transactional email. |

The server reads the unprefixed names and the browser reads the `VITE_`-prefixed
ones, so both pairs need to be set.

### Optional (features degrade cleanly without them)

| Variable            | Purpose                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`    | Enables PulseAssist. Without it the AI endpoints return `AI_NOT_CONFIGURED`.                                                        |
| `OPENAI_MODEL`      | Override the chat model (default `gpt-4o-mini`).                                                                                    |
| `RESEND_API_KEY`    | Enables transactional email. Without it pitches and verification decisions still land in-app, and the UI says no email was sent.    |
| `RESEND_FROM_EMAIL` | Sender, e.g. `The Ledger <noreply@yourapp.com>`. **Required when `RESEND_API_KEY` is set** — the domain must be verified in Resend. |
| `VITE_ADMIN_DOMAIN` | Hostname allowed to reach `/admin`. See below.                                                                                      |
| `VITE_TERMS_URL`    | Link target for the terms in the sign-in consent line. Rendered as plain text when unset.                                           |

| `VITE_AUTH_PROVIDERS` | Comma-separated OAuth providers to show, e.g. `github,google`. Each must be enabled in Supabase first. Empty means email-only. |

### Admin domain gating

`/admin` is restricted to a single hostname.

- Set `VITE_ADMIN_DOMAIN` to the admin hostname, e.g. `admin.yourapp.com`.
- **In a production build, leaving it unset blocks `/admin` entirely.** The gate
  fails closed on purpose: a forgotten build arg should not publish the admin
  panel on your main domain.
- `localhost` is always allowed so local development needs no extra config.

Add **two** custom domains to the same Railway service:

- `app.yourapp.com` — user-facing (cannot reach `/admin`)
- `admin.yourapp.com` — admin-only

Both point at the same deployment; `VITE_ADMIN_DOMAIN` is what separates them.

Note this is a routing convenience, not the security boundary. Admin authority
comes from a row in `user_roles`, which every privileged server function
re-checks with `is_admin()` using the caller's own token.

## How the build works

`railway.json` pins the builder to **Nixpacks**, so `nixpacks.toml` is what
Railway actually runs. The `Dockerfile` is kept for building the image locally or
deploying somewhere else; switch `railway.json` to `"builder": "DOCKERFILE"` if
you want Railway to use it instead. Keep the `VITE_*` lists in the two files in
sync — whichever builder is active needs every one declared.

- **Build**: `bun install --frozen-lockfile && bun run build`
  - Vite + TanStack Start + Nitro → outputs to `.output/`
  - Nitro preset: `node-server`

> **Why `nitro` is pinned to `3.0.260903-beta`.**
> On `3.0.260603-beta`, requests for files under `public/` could hang until the
> client timed out, with srvx logging
> `TypeError: Spread syntax requires ...iterable not be null or undefined` from
> `sendNodeResponse`. Static requests never reach `src/server.ts`, so this was not
> application code.
>
> This reproduced locally (Bun 1.2.14) but **not** on Railway — the deployment
> built from the same commit served `/robots.txt`, `/favicon.svg` and `/og.svg`
> normally. So it appears to be environment-dependent rather than a guaranteed
> production failure. The upgrade is a later patch of the same beta line and
> removes the failure mode; if you ever pin back, re-test static assets directly
> rather than relying on a healthcheck against `/`, which is SSR and stays green
> either way.

- **Start**: `bun .output/server/index.mjs`
  - Listens on `PORT` (Railway injects this)
  - Serves static assets from `.output/public/`

> **`VITE_*` vars are baked in at build time.**
> Vite inlines them into the client bundle during `bun run build`, so they must
> exist _before_ a deploy is triggered, and the Dockerfile has to declare each one
> as an `ARG` for Railway to pass it into the build layer. If they're missing the
> bundle gets empty strings and every page fails with "Something went wrong."
>
> The corollary: never put a secret in a `VITE_` variable. Anything prefixed
> `VITE_` is readable by every visitor.

## Supabase Auth configuration

These live in the Supabase dashboard rather than environment variables, and the
app misbehaves if they are wrong:

- **Authentication → URL Configuration → Site URL** must be the full origin
  _including the scheme_, e.g. `https://your-app.up.railway.app`. A value missing
  `https://` breaks email confirmation and OAuth redirects.
- **Redirect URLs** must include the production origin. The app redirects to
  `<origin>/feed` after sign-in, so add `https://your-app.up.railway.app/**`.
- **Authentication → Providers**: enable only providers you hold real client
  credentials for, then list those same providers in `VITE_AUTH_PROVIDERS` so the
  sign-in card offers them. The two must agree, or users get buttons that only
  produce an error.
- **Password minimum length** should match the client, which enforces 8.

## Service role key

`SUPABASE_SERVICE_ROLE_KEY` must authenticate against **both** PostgREST and the
GoTrue admin API — the server functions call `auth.admin.getUserById` to resolve
recipient email addresses.

On this project the new-format `sb_secret_…` keys are rejected with HTTP 401 by
both services, even when freshly created, so the legacy `service_role` JWT is
configured instead. Re-test a new-format key after Supabase migrates this project
to asymmetric JWT signing keys. Both of these must return 200:

```sh
curl -o /dev/null -w '%{http_code}\n' \
  "https://<ref>.supabase.co/rest/v1/profiles?select=id&limit=1" -H "apikey: <key>"

curl -o /dev/null -w '%{http_code}\n' \
  "https://<ref>.supabase.co/auth/v1/admin/users?per_page=1" \
  -H "apikey: <key>" -H "Authorization: Bearer <key>"
```

## Database

Apply everything in `supabase/migrations/` in filename order:

```sh
supabase db push
```

Migrations are named so lexicographic order is apply order, and each one is
written to be safe to re-run.

## Granting the first admin

There is no bootstrap UI, by design. Insert the role directly in
Supabase → SQL Editor:

```sql
insert into public.user_roles (user_id, role)
values ('<the-user-uuid>', 'admin')
on conflict do nothing;
```

Confirm it took effect, signed in as that user:

```sql
select public.is_admin();  -- expect true
```

`/admin` reads admin status from `user_roles` only. There is no environment-variable
override — `VITE_ADMIN_IDS` was removed because `VITE_*` values are readable by
every visitor.
