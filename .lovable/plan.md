
# Godson — Multi-User Rebuild Plan

Turning the current single-page Status Studio into a real product: signed-in users, a personal Studio, a public Feed, profiles, and gated DMs. Backed by Lovable Cloud (Supabase under the hood).

## Current state (already working)

- Live editor + 9:16 preview card + 1080×1920 PNG export via `html-to-image`.

I'll keep the export engine and card visual language; everything else becomes multi-user.

## 1. Backend — enable Lovable Cloud

Adds Postgres, auth, storage, and server functions. No external accounts.

**Tables (SQL will run automatically via migrations — shown here for transparency):**

```text
profiles (id uuid PK → auth.users, handle unique, display_name, avatar_url, bio, created_at)
posts    (id uuid PK, author_id → profiles, content text ≤280, background text,
          image_url, created_at)
follows  (follower_id, following_id, created_at, PK(follower,following))
conversations (id, user_a, user_b unique-pair, created_at)
messages (id, conversation_id → conversations, sender_id, body ≤1000, created_at)
reports  (id, post_id → posts, reporter_id, reason, created_at)
daily_request_counts (user_id, day date, count) — enforces 3 new convos/day
```

RLS on every table. Roles in a separate `user_roles` table (not on profiles) — guarded by a `has_role()` security-definer function.

**Storage buckets:** `avatars` (public read), `post-images` (public read, owner write).

## 2. Auth — Google sign-in

- Public landing at `/` with a single "Continue with Google" CTA and a preview of the card aesthetic.
- Managed Google OAuth via Lovable Cloud's helper (iframe-safe in the preview).
- On first sign-in, DB trigger auto-creates a `profiles` row from Google name + avatar; handle is derived from email prefix and can be edited.

## 3. Routes

```text
/                  Public landing (signed-out) / redirects to /feed if signed-in
/feed              Public feed (masonry grid, real-time)
/u/$handle         Public profile: user info + their published cards
/studio            The Studio — editor, preview, export, publish  (auth)
/messages          Conversation list                              (auth)
/messages/$id      Thread view                                    (auth)
/settings          Handle, avatar, bio                            (auth)
```

Auth-gated routes live under `_authenticated/` (managed layout).

## 4. The Studio (`/studio`)

- Live editor: name (from profile, editable per-card), title, content (**hard cap 280 chars** with live counter, red at ≥260).
- Background toggle: **Tech Noir Dark** (current) or **Premium Cream** (warm off-white, ink foreground, subtle dot grid).
- Avatar: use Google avatar by default, or upload custom image → `post-images` bucket.
- Buttons:
  - **Download for WhatsApp Status** — existing 1080×1920 PNG export.
  - **Publish to Feed** — inserts into `posts` and redirects to `/feed`.

## 5. The Feed (`/feed`)

- Real-time masonry grid (CSS columns, responsive 1/2/3 cols) subscribed to `posts` via Supabase Realtime — new posts fade in at the top.
- Each card: mini status card + author name (links to `/u/$handle`) + relative timestamp + report flag + (if signed-in and not self) "Message" button.
- Report flag opens a small dialog → inserts into `reports`.

## 6. Profiles (`/u/$handle`)

- Header: avatar, display name, @handle, bio, follow/unfollow, "Message" button.
- Grid of the user's published cards.
- Public route with proper `head()` OG metadata per profile.

## 7. Messaging (`/messages`, `/messages/$id`)

Gating rules enforced server-side:
- **Start a new conversation** only if:
  - both users follow each other (mutual follow), OR
  - the sender has started < 3 new conversations today (tracked in `daily_request_counts`).
- Once a conversation exists, both parties can freely exchange messages.
- Server function `startConversation({ recipientId })` runs the checks; UI shows the exact reason on rejection.
- Thread view: real-time messages, 1000-char cap, own bubbles right-aligned.

## 8. Content controls

- RLS: users can only UPDATE/DELETE their own `posts`, `profiles`, `messages`, `follows`.
- Reports readable only by admins (via `has_role(auth.uid(), 'admin')`).
- Publishable-key server client for public reads on the feed/profile SSR paths; authenticated server fns for everything user-scoped.

## 9. Design

- Keep the tech-noir palette as the default; add Premium Cream as a second background token set.
- Inter for UI, tighter tracking on headings, generous whitespace, hairline borders — same restraint as the current card.
- Fully responsive; mobile-first (matches your 360-wide preview).

## Technical notes

- Stack: TanStack Start + React 19 + Tailwind v4 + Lovable Cloud (Supabase). `html-to-image` for export (already installed).
- Realtime via `supabase.channel().on('postgres_changes', ...)` for feed + threads.
- Route architecture per project conventions: file-based routes in `src/routes/`, auth-gated subtree under `src/routes/_authenticated/`.
- Google OAuth uses the Lovable-managed broker; I'll enable the Google provider in the same step.

## Out of scope (call out if you want them added)

- Likes / comments / reposts.
- Notifications (email or in-app).
- Rich text or link previews inside posts.
- Admin moderation dashboard (reports are recorded but reviewed in DB for now).

## Delivery order

1. Enable Cloud + create schema + RLS + storage buckets.
2. Landing page + Google auth + auto-profile trigger.
3. `/studio` (port existing editor, add cream theme + 280 cap + publish + avatar).
4. `/feed` with realtime masonry.
5. `/u/$handle` profiles + follow/unfollow.
6. `/messages` with mutual-follow / 3-per-day gating.
7. Report flag + settings page.

Approve and I'll build in that order.
