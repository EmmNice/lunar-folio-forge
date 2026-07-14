---
name: Supabase project/env cross-check
description: How to catch a mismatched Supabase project ref before wasting time debugging phantom SQL/auth errors.
---

When a user pastes a `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or similar credential, extract the project ref from it
(DB URL: the `postgres.<ref>` username segment or host subdomain; JWT keys: base64-decode the payload and read `ref`) and
diff it against the project ref already baked into the app's `SUPABASE_URL` / `VITE_SUPABASE_PROJECT_ID`. Do this *before*
running any SQL or trusting connection success/failure as a signal.

**Why:** A pasted credential for the wrong project produces confusing, unrelated-looking failures (auth errors, "function
does not exist", schema-cache misses) that look like bugs in the SQL or app code, when the real cause is simply "this
credential points at a different database than the one the app talks to." Diagnosing this by trial and error burns a lot
of turns; checking the ref up front is instant.

**How to apply:** Any time you're handed a new DB connection string or service-role key mid-session — especially after a
user says "here's the DB URL" or after creating a brand-new Supabase project — decode/parse it and compare refs before
using it for anything.
