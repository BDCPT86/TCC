-- ============================================================
-- 9 — public_players: move the photo gate into the database
--
-- This fixes a 401, but that is the least of what it fixes.
--
-- THE CHILD-SAFETY PROBLEM
-- A minor's photo may only be shown with media consent on file.
-- players.js enforces that — in the browser:
--
--     function photoAllowedFor(p) {
--       return !!p.photo_url && !(isMinorPlayer(p) && !p.media_consent);
--     }
--
-- The API still hands photo_url to everyone. The page merely declines
-- to render it. Anyone who opens the network tab, or calls the REST
-- endpoint with the anon key that ships in the page, gets the photo
-- URL of a non-consented minor and can open it directly. A gate in the
-- client is not a gate.
--
-- Worse, index.html's squad section (main.js) has no gate at all and
-- renders photo_url for every player.
--
-- THE STALE-FLAG PROBLEM
-- players.js says, correctly:
--     "Minor status is DERIVED from dob so it self-corrects on a
--      birthday — never trust a stored is_minor flag, it goes stale."
-- and then does not select dob, so playerAge() always returns null and
-- it falls back to the very flag it warns about.
--
-- THE FIX
-- The rule becomes one function, used by one view that runs with its
-- owner's rights:
--   * minor status derived from dob, every time it is read;
--   * photo_url returned as NULL for a minor without consent, so the
--     URL does not leave the database at all;
--   * dob, is_minor and media_consent exposed to nobody.
--
-- NOTE ON THE FIRST VERSION OF THIS FILE: its self-test inserted
-- probe rows into `players` — a live table of real members — and then
-- failed on a NOT NULL column it had never checked for. Nothing here
-- writes to any table now. The rule lives in a function, and the test
-- calls that function over a list of values, so it exercises the real
-- logic without touching a single row.
--
-- Safe to run twice.
-- ============================================================

/* ── The rule, in one place ──────────────────────────────────
   STABLE rather than IMMUTABLE: it reads current_date, so its answer
   changes on a birthday. That is the entire point. */
create or replace function public.photo_visible(
  p_photo_url     text,
  p_dob           date,
  p_is_minor      boolean,
  p_media_consent boolean
) returns text
language sql
stable
parallel safe
as $$
  select case
    /* No photo, nothing to decide. */
    when p_photo_url is null then null
    /* A minor without consent has no photo as far as the public is
       concerned — not a photo that pages agree not to show.

       dob is the authority. With no dob we cannot prove the player is
       an adult, so the stored flag is used; with neither, the safe
       reading is "treat as a minor". Being wrong that way costs an
       adult a profile picture. Being wrong the other way publishes a
       child's photograph. */
    when coalesce(
           case when p_dob is not null
                then p_dob > (current_date - interval '18 years')
                else p_is_minor end,
           true)
         and coalesce(p_media_consent, false) = false
      then null
    else p_photo_url
  end
$$;

comment on function public.photo_visible(text, date, boolean, boolean) is
  'Returns the photo URL, or null when it belongs to a minor without media consent. Minor status is derived from dob so it self-corrects on a birthday. Used by public_players; this is the single definition of that rule.';

/* anon MUST be able to execute this.

   I first revoked it, reasoning that the view runs with its owner's
   rights so anon never calls the function itself. That is wrong, and it
   broke the view with:

       42501 permission denied for function photo_visible

   security_invoker = off redirects privilege checks on the TABLES a
   view reads. It does not cover EXECUTE on functions in the view body —
   those are still checked against the calling role. The planner even
   inlines this function so no call happens at run time, but the
   privilege check happens before inlining, so that does not save it.

   Granting it gives nothing away. The function is a pure transform of
   four arguments the caller has to supply itself. Calling
   photo_visible('x', '2010-01-01', true, false) directly returns null —
   it reads no table and holds no secret. The protection is that anon
   cannot get a real player's dob or media_consent to pass in. */
revoke all on function public.photo_visible(text, date, boolean, boolean) from public;
grant execute on function public.photo_visible(text, date, boolean, boolean) to anon, authenticated;

/* ── The view ────────────────────────────────────────────── */
create or replace view public.public_players
  /* Owner's rights, deliberately. anon has no grant on `players` — and
     must not have one, because that is where dob, email, phone and the
     guardian details live. This view is the only way in, the same
     pattern fantasy_players uses. Supabase's advisor will flag it as a
     "security definer view"; that is expected, and switching it to
     invoker breaks it with 42501. See 8-restore-fantasy-views.sql. */
  with (security_invoker = off) as
select
  p.id,
  p.name,
  p.nickname,
  p.role,
  p.squad,
  p.active,
  p.captain,
  p.vice_captain,
  p.fantasy_value,
  p.batting_hand,
  p.bowling_style,
  p.bio,
  p.cricket_hero,
  p.favourite_shot,
  p.years_at_tcc,
  p.member_type,
  public.photo_visible(p.photo_url, p.dob, p.is_minor, p.media_consent) as photo_url
from public.players p;

comment on view public.public_players is
  'Everything the public pages may know about a player. photo_url is null for a minor without media consent, and dob/is_minor/media_consent are not exposed at all.';

revoke all on public.public_players from anon, authenticated;
grant select on public.public_players to anon, authenticated;

notify pgrst, 'reload schema';

-- ── 1. Nothing sensitive got out ────────────────────────────
-- Expect 0 rows.
select column_name
from   information_schema.columns
where  table_schema = 'public' and table_name = 'public_players'
  and  column_name in ('dob','is_minor','media_consent','email','phone',
                       'guardian_name','guardian_phone','guardian_relationship');

-- ── 2. The gate, against every case that matters ────────────
-- Calls the real function. Writes nothing, reads no member's row.
with probe(who, dob, is_minor, media_consent, expect_photo) as (values
  ('adult, consent',                  (current_date - interval '30 years')::date, false, true,  true),
  ('adult, no consent',               (current_date - interval '30 years')::date, false, false, true),
  ('adult, consent null',             (current_date - interval '30 years')::date, false, null,  true),
  ('minor, consent',                  (current_date - interval '14 years')::date, true,  true,  true),
  ('minor, NO consent',               (current_date - interval '14 years')::date, true,  false, false),
  ('minor, consent null',             (current_date - interval '14 years')::date, true,  null,  false),
  ('18 as of yesterday, no consent',  (current_date - interval '18 years' - interval '1 day')::date,  true,  false, true),
  ('18 tomorrow, no consent',         (current_date - interval '18 years' + interval '1 day')::date,  false, false, false),
  ('no dob, flagged minor, no consent', null::date, true,  false, false),
  ('no dob, flagged adult, no consent', null::date, false, false, true),
  ('no dob, no flag, no consent',       null::date, null,  false, false),
  ('no photo at all',                   null::date, false, true,  false)
)
select who,
       case when expect_photo then 'shown' else 'withheld' end as expected,
       case when public.photo_visible(
                   case when who = 'no photo at all' then null else 'https://example.com/p.jpg' end,
                   dob, is_minor, media_consent) is not null
            then 'shown' else 'withheld' end as actual,
       case when expect_photo = (public.photo_visible(
                   case when who = 'no photo at all' then null else 'https://example.com/p.jpg' end,
                   dob, is_minor, media_consent) is not null)
            then 'ok' else '<<< WRONG — DO NOT DEPLOY' end as verdict
from probe;

-- ── 3. anon reads the view, and not the columns it protects ──
do $$
declare n int; v text;
begin
  set local role anon;
  /* photo_url specifically, NOT count(*).

     The version of this test I shipped asked count(*) — and count(*)
     never mentions photo_url, so it never touched photo_visible() and
     reported a healthy view while the real query was failing with
     42501. I had written the warning about count(*) hiding a column
     problem three lines further down and then made the same mistake
     for the function. Select the column that does the work. */
  begin
    select photo_url into v from public.public_players limit 1;
    raise notice 'anon CAN select photo_url from public_players';
  exception when others then
    raise notice 'BROKEN: % / %', sqlstate, sqlerrm;
  end;
  begin
    select count(*) into n from public.public_players;
    raise notice 'anon CAN read public_players (% rows)', n;
  exception when others then
    raise notice 'BROKEN: % / %', sqlstate, sqlerrm;
  end;
  /* And the columns the view exists to keep in. A column grant lets
     count(*) through, so that question has to be asked directly. */
  begin
    perform dob from public.players limit 1;
    raise notice 'PROBLEM: anon can read players.dob directly';
  exception when others then
    raise notice 'anon correctly cannot read players.dob';
  end;
  begin
    perform media_consent from public.players limit 1;
    raise notice 'PROBLEM: anon can read players.media_consent directly';
  exception when others then
    raise notice 'anon correctly cannot read players.media_consent';
  end;
  reset role;
end $$;

-- ── 4. A real spot-check, read-only ─────────────────────────
-- How many members have a photo on file, and how many of those the
-- public may actually see. A gap here is minors without consent, which
-- is the gate working.
select count(*) filter (where p.photo_url is not null)        as photos_on_file,
       count(*) filter (where v.photo_url is not null)        as photos_public,
       count(*) filter (where p.photo_url is not null
                         and v.photo_url is null)             as withheld
from   public.players p
join   public.public_players v on v.id = p.id;
