-- Stop moderation from destroying its own evidence.
--
-- `reports.post_id` was declared ON DELETE CASCADE, which made sense when the
-- only thing that ever deleted a post was its own author. Now that an admin can
-- remove a post from the moderation queue, the cascade fires on exactly the
-- action a moderator just took: the post goes, and the report goes with it --
-- taking the reason, the reviewer, the resolution note and the timestamp.
--
-- Verified on production: resolving a report with "Remove post" left
-- `reports` empty. The admin_actions entry survived, so the action was still
-- attributable, but the report history itself was gone -- which is the record you
-- would want if the member disputed the decision, or if you needed to see how
-- often a given reporter is right.
--
-- ON DELETE SET NULL keeps the row. The moderation queue already renders the
-- missing-post case ("The reported post has already been deleted."), so nothing
-- downstream needs to change.

alter table public.reports alter column post_id drop not null;

alter table public.reports drop constraint if exists reports_post_id_fkey;
alter table public.reports
  add constraint reports_post_id_fkey
  foreign key (post_id) references public.posts(id) on delete set null;

-- The queue only ever lists open reports, and a report whose post is gone cannot
-- be actioned further, so a partial index keyed on the open ones stays useful.
-- Recreated here because the column definition changed underneath it.
drop index if exists reports_open_idx;
create index reports_open_idx
  on public.reports (created_at desc)
  where status = 'open';

comment on column public.reports.post_id is
  'The reported post, or null once that post has been removed. Nulled rather than '
  'cascaded so a resolved report survives the removal it caused.';

-- `unique (post_id, reporter_id)` still stops one member filing twice against the
-- same post. Postgres treats NULLs as distinct in a unique index, so several
-- resolved reports whose posts are gone coexist happily.
