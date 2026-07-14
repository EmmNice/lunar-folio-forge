---
name: Lovable-scaffolded app auth
description: Why Google/OAuth login in a Lovable-originated app can break after moving off Lovable's backend, and how to fix it.
---

Apps originally scaffolded by Lovable (TanStack Start + Supabase stack) often ship a "Continue with Google" (or
Apple/Microsoft) button implemented via `@lovable.dev/cloud-auth-js`'s `createLovableAuth().signInWithOAuth(...)`
(usually wrapped in `src/integrations/lovable/index.ts`). This routes the OAuth handshake through Lovable's own
hosted auth proxy, which is registered against the specific Supabase project Lovable originally provisioned.

**Why:** If the project is later pointed at a different/independent Supabase project (e.g. the user creates their own
fresh Supabase project and the app's env vars are repointed to it), that Lovable OAuth proxy has no relationship to
the new project and login breaks, even though everything else (schema, RLS, direct email/password auth) works fine.

**How to apply:** When migrating a Lovable-originated app off its original Supabase project, check for
`@lovable.dev/cloud-auth-js` usage and any `lovable.auth.*` calls. Replace them with native
`supabase.auth.signInWithPassword` / `supabase.auth.signUp` (or properly configure OAuth providers directly in the
new Supabase project's Auth settings) rather than assuming the existing "Google sign-in" button still works. Also
check for `window.__lovableEvents` error-reporting hooks (`reportLovableError`-style helpers) — these are Lovable
platform telemetry with nothing to call once the app leaves Lovable's hosting, safe to remove. Leave build-tooling
packages like `@lovable.dev/vite-tanstack-config` alone unless asked — they're just vite config wiring, not a
user-facing "Lovable feature."
