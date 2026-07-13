
-- Pin search_path on remaining trigger functions
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.bump_conversation_activity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.conversations
    set last_message_at = new.created_at
    where id = new.conversation_id;
  return new;
end;
$$;

-- Lock down SECURITY DEFINER executables: only the app's server code (service_role)
-- and RLS-scoped policy checks need to invoke has_role directly.
revoke execute on function public.has_role(uuid, public.app_role) from public;
revoke execute on function public.has_role(uuid, public.app_role) from anon;
revoke execute on function public.has_role(uuid, public.app_role) from authenticated;
grant execute on function public.has_role(uuid, public.app_role) to service_role;

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
-- handle_new_user is only invoked by the auth trigger; no client role needs it.
