-- Move notification preferences off the client.
--
-- These toggles used to live in localStorage, which meant they were per-browser,
-- lost on a cache clear, and invisible to the server functions that actually
-- send the email. Storing them on the profile lets the sender honour them.

alter table public.profiles
  add column if not exists notification_prefs jsonb not null
    default '{"messages": true, "pitches": true, "system": true}'::jsonb;

-- Normalise anything that predates the column default before we constrain it,
-- so this migration stays safe to re-run.
update public.profiles
set notification_prefs = '{"messages": true, "pitches": true, "system": true}'::jsonb
where jsonb_typeof(notification_prefs -> 'messages') is distinct from 'boolean'
   or jsonb_typeof(notification_prefs -> 'pitches') is distinct from 'boolean'
   or jsonb_typeof(notification_prefs -> 'system') is distinct from 'boolean';

-- Guarantee the three keys are always present and boolean so server-side reads
-- never have to second-guess the shape.
alter table public.profiles
  drop constraint if exists profiles_notification_prefs_shape;

alter table public.profiles
  add constraint profiles_notification_prefs_shape check (
    jsonb_typeof(notification_prefs -> 'messages') = 'boolean'
    and jsonb_typeof(notification_prefs -> 'pitches') = 'boolean'
    and jsonb_typeof(notification_prefs -> 'system') = 'boolean'
  );
