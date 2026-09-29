-- Make the weekly inbound-pitch cap actually hold under concurrency.
--
-- submitPitch counted the recipient's pitches from the last 7 days, compared the
-- count to their pitch_limit, and then inserted. Two senders firing at the same
-- moment both read the same count and both passed, so a member who set "3 per
-- week" could receive more than three. The AI-credit and conversation caps were
-- already moved into single-statement RPCs for exactly this reason
-- (20260928000100); this is the one that was left behind.
--
-- Taking a row lock on the recipient's profile serialises the check and the
-- insert per recipient, which is the narrowest lock that fixes it: pitches to
-- different members never contend.

create or replace function public.claim_pitch_slot(
  _sender_id uuid,
  _recipient_id uuid,
  _company_name text,
  _pitch text,
  _deck_url text,
  _weekly_limit integer,
  _window_days integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _recent integer;
  _id uuid;
begin
  -- Serialise concurrent pitches to the same recipient. A null pitch_limit means
  -- unlimited, so there is nothing to serialise and nothing to count.
  if _weekly_limit is not null then
    perform 1 from public.profiles where id = _recipient_id for update;

    if _weekly_limit <= 0 then
      return null;
    end if;

    select count(*) into _recent
      from public.pitches
     where recipient_id = _recipient_id
       and created_at >= now() - make_interval(days => _window_days);

    if _recent >= _weekly_limit then
      return null;
    end if;
  end if;

  insert into public.pitches (sender_id, recipient_id, company_name, pitch, deck_url)
  values (_sender_id, _recipient_id, _company_name, _pitch, _deck_url)
  returning id into _id;

  return _id;
end;
$$;

comment on function public.claim_pitch_slot(uuid, uuid, text, text, text, integer, integer) is
  'Checks the recipient''s weekly pitch cap and inserts the pitch under one row '
  'lock. Returns the new pitch id, or null when the recipient is at their cap.';

-- service_role only. This function writes a pitch on behalf of a sender id it is
-- handed, so a member able to call it directly could forge pitches from anyone.
revoke all on function public.claim_pitch_slot(uuid, uuid, text, text, text, integer, integer)
  from public, anon, authenticated;
