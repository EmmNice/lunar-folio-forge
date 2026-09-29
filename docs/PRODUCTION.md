# Production runbook

Everything needed to stand this platform up, plus the two things that are still
waiting on credentials. Written to be followed, not skimmed.

---

## 1. What runs where

| Piece | Where | Notes |
| --- | --- | --- |
| App (SSR + server functions) | Railway, builds from `main` | Nitro output, `bun .output/server/index.mjs` |
| Database, auth, storage | Supabase | Postgres + RLS is the real authorization layer |
| Transactional email (pitches, verification) | Resend, optional | Absent → the app says no email was sent instead of pretending |
| Auth email (confirm, reset) | Supabase | **Needs custom SMTP. See §4.** |

---

## 2. Environment variables

`.env.example` is the authoritative list with per-variable commentary. The short
version:

**Required**

```
SUPABASE_URL                     https://<ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY         sb_publishable_… (or a legacy anon JWT)
VITE_SUPABASE_URL                same as SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY    same as SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY        bypasses RLS — server only, never VITE_
APP_URL                          public https origin, scheme included
```

**Optional, each degrades honestly when unset**

```
OPENAI_API_KEY        PulseAssist. Unset → endpoints return AI_NOT_CONFIGURED and the UI says so
RESEND_API_KEY        pitch + verification email. Unset → in-app only, UI reports no email sent
RESEND_FROM_EMAIL     required whenever RESEND_API_KEY is set; domain must be verified
VITE_ADMIN_DOMAIN     hostname allowed to reach /admin. Unset in a prod build blocks /admin entirely
VITE_AUTH_PROVIDERS   comma-separated OAuth providers to offer, e.g. "github,google"
VITE_TERMS_URL        link target for the terms line on the auth card
```

`APP_URL` matters more than it looks: it builds the links in outbound email and
seeds the CSRF origin allow-list. A staging deploy that inherits production's
value will send people to production.

---

## 3. Supabase Auth configuration

Auth settings live in Supabase, not in the repo, which makes them the easiest part
of the stack to lose — nothing reviews them and nothing recreates them on a new
project. A wrong Site URL or an allow-list missing `/reset-password` breaks account
recovery in a way no test would catch.

`scripts/configure-supabase-auth.mjs` is the source of truth. It is idempotent and
prints a diff before changing anything.

```bash
SUPABASE_ACCESS_TOKEN=sbp_…      # Account → Access Tokens
SUPABASE_PROJECT_REF=<ref>       # Project Settings → General
APP_URL=https://your-deployment

node scripts/configure-supabase-auth.mjs          # dry run, shows the diff
node scripts/configure-supabase-auth.mjs --apply  # write it
```

What it sets, and why:

| Setting | Value | Reason |
| --- | --- | --- |
| `site_url` | `APP_URL` origin | Emailed links are built from it. No scheme → broken links |
| `uri_allow_list` | origin + `/**` + explicit paths | `/**` is what permits `/reset-password` and the OAuth callback |
| `password_min_length` | 8 | Must match `MIN_PASSWORD_LENGTH` in `src/lib/limits.ts` |
| `password_required_characters` | lower + upper + digit | Rejects the weakest passwords without pushing people to `Password1!` |
| `mailer_otp_exp` | 3600 | Matches the "expires in one hour" copy in the emails and on `/reset-password` |
| `mailer_secure_email_change_enabled` | true | A changed address is confirmed on both mailboxes, so a stolen session can't move the account |
| `refresh_token_rotation_enabled` | true | With a 10s reuse window, a stolen refresh token is detectable |
| `external_anonymous_users_enabled` | false | This is an identity-first network |

Run it after any change to `APP_URL`, and on every new project.

---

## 4. Email / SMTP — the one outstanding item

**Status: not configured. It needs a provider credential that has to be created by
an account owner.**

Right now the project uses Supabase's built-in sender. That has three consequences,
all of which clear together:

1. **Email confirmation is off.** Supabase's shared sender is capped at roughly two
   messages an hour, so requiring confirmation would mean most new members never
   receive the link and cannot get in at all. Leaving it off is the lesser evil —
   but it means **anyone can register an address they do not own**.
2. **Password reset is throttled** to that same ceiling. The flow is implemented and
   verified end to end; only delivery is weak.
3. **The branded email templates are not applied.** Supabase refuses template
   changes on the free tier while the default sender is in use:
   `Email template modification is not available for free tier projects using the
   default email provider`. The templates are written and ready in
   `scripts/configure-supabase-auth.mjs`; they install automatically the moment
   SMTP exists.

### Finishing it

Any SMTP provider works. Resend is the one the app already uses for pitch and
verification mail, so it keeps things to a single vendor.

1. Create the provider account and verify the sending domain (DNS: SPF + DKIM).
   Nothing will deliver reliably until the domain is verified.
2. Take the SMTP credentials. For Resend: host `smtp.resend.com`, port `587`,
   user `resend`, password = the API key.
3. Run:

   ```bash
   SUPABASE_ACCESS_TOKEN=sbp_… \
   SUPABASE_PROJECT_REF=<ref> \
   APP_URL=https://your-deployment \
   SMTP_HOST=smtp.resend.com \
   SMTP_PORT=587 \
   SMTP_USER=resend \
   SMTP_PASS=re_… \
   SMTP_SENDER_EMAIL=noreply@yourdomain.com \
   SMTP_SENDER_NAME="The Ledger" \
     node scripts/configure-supabase-auth.mjs --apply
   ```

   That single run enables confirmation, raises `rate_limit_email_sent` to 100, and
   installs the branded templates.

4. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` on Railway too, so pitch and
   verification email start flowing.
5. Verify: sign up with a real address, confirm the link arrives and works; then
   run a password reset and check the same.

Until step 3 is done, treat every account's email address as unverified.

---

## 5. Bot protection

`security_captcha_enabled` is false. Supabase supports hCaptcha and Turnstile;
both need a site key and secret from the provider, so this is also credential-gated.
Once you have a pair, set them in Supabase → Auth → Bot and Abuse Protection and
add the widget to the sign-up form in `src/routes/index.tsx`.

Signup is not otherwise rate limited beyond Supabase's own per-IP limits, so this
is worth doing before any public launch push.

---

## 6. Database migrations

```bash
supabase db push        # against a linked project
```

27 migrations, applied in filename order. They are written to be re-runnable: the
suite applies the whole set twice against a fresh Postgres and asserts a clean pass
both times.

Two things worth knowing before editing the schema:

- **RLS is the authorization layer, not the UI.** Post audience, moderation state,
  quotas and admin rights are all enforced in policies, because the browser holds a
  publishable key and can call the REST API directly.
- **`profiles` uses column-level grants.** Table-wide `SELECT` plus a `USING (true)`
  policy is what previously published every member's date of birth. Private columns
  are reachable only through `current_profile()`. Consequence: `RETURNING *` on
  `profiles` fails with a *table*-level permission error, which looks like a missing
  UPDATE grant. Name your columns — `.select("id,bio")`, not `.select()`.

---

## 7. Verification suites

Not in CI (no runner configured), but all runnable locally. They need Docker and,
for the live ones, `SB_TOKEN` / `REF` / `HOST`.

| Script | Covers |
| --- | --- |
| `run.sh` | 95 RLS / quota / escalation checks through PostgREST with real JWTs |
| `verify_rest.sh` | Migrations applied twice, built server routes + headers, client bundle has no secrets |
| `validate_migrations.sh` | Schema and behaviour assertions against a fresh database |
| `audit_security.sh` | Live project: grants, policies, definer hygiene, storage |
| `live_rls.sh` | Live project: RLS boundaries with real tokens |
| `live_product.sh` | Live deployment: audience rules, moderation, reports, DMs, admin authorization |

One trap, recorded because it cost real time: these scripts export `HOST` as the
deployed hostname, and **srvx reads `HOST` as its bind address**. Sourcing the env
file before `verify_rest.sh` made the built server try to bind to the production
hostname and report `EADDRINUSE` with `errno: 0`. The suite now launches the server
with `env -u HOST`.

---

## 8. What is deliberately absent

Not oversights — decisions, so nobody goes looking for them:

- **No billing.** `subscription_status` exists with a constrained domain and is set
  by hand. There is no Stripe, no webhook, no checkout.
- **No follow graph.** Removed in the second migration on purpose; the feed is one
  global chronological timeline.
- **Reposts do not render.** The button increments a counter and notifies the
  author. Surfacing reposts in the feed is a design decision, not a bug fix.
- **No blocking or muting between members.** The privacy controls are
  `dm_cloaking_enabled`, `hide_from_search` and `pitch_limit`.
- **No post editing, no comment nesting.**
- **`hide_from_search` is cosmetic** — there is no in-app search for it to hide from.
- **CSP keeps `script-src 'unsafe-inline'`** because TanStack Start emits its
  hydration payload inline. Tightening it needs per-request nonces threaded through
  the SSR renderer.
- **No external error reporting.** Server errors go to stdout and Railway's logs.
