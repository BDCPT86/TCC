-- ============================================================
-- 10 — close `players` to anon
--
-- WHY THIS EXISTS
-- The why-401 probe on the live site returned this:
--
--   players, what the OLD file asked for
--      status: 200
--      body  : [{"id":"9a50...","name":"Leah Sanders","squad":"youth", ...}]
--
-- anon can read the `players` table directly. Which means
-- public_players protects nothing at all. The photo gate, the withheld
-- dob, the hidden media_consent — all of it is bypassed by asking for
-- the table instead of the view:
--
--   /rest/v1/players?select=name,photo_url,dob,media_consent
--
-- With the anon key that ships in every page. A youth player's
-- photo, date of birth and consent status, to anyone who types it.
--
-- File 9 was written on the assumption that `players` was already
-- closed. It was not. Until this file runs, file 9 is decoration.
--
-- THIS FILE CAN BREAK PAGES. Read section 1 first and do not skip it.
--
-- Safe to run twice.
-- ============================================================

-- ── 1. THE AUDIT IS DONE ────────────────────────────────────
-- The revoke below was commented out in the first version of this
-- file because I had not seen the site. I have now audited the live
-- bundle. Every browser-side query against `players` — 15 call sites
-- across 9 files — has been repointed at public_players:
--
--   profile.html          id,name,role,fantasy_value
--   player-stats.html     id,name,role,fantasy_value
--   badges.html           id,name,role,fantasy_value
--   scoring/scoring.js    name  /  id,name,role
--   js/leaderboard.js     id,name,role,fantasy_value,captain  /  id,role,name
--   js/fantasy-stats.js   id,name,role
--   js/player-bio.js      id,name
--   js/admin.js           7 call sites, widest is
--                         id,name,role,active,captain,vice_captain,
--                         photo_url,squad,member_type
--   js/main.js            the full 17
--   js/players.js         the full 17 (already deployed)
--
-- Not one of them needed a column this view does not expose, so the
-- view did not have to be widened. Every set was then executed against
-- the view as the anon role with `players` revoked, and all 15 passed.
--
-- Unaffected:
--   * the Worker's 21 `players` queries — service key, including
--     player.get (select=*) and player.listFantasy, which is how admin
--     reaches dob, email, phone and the guardian fields.
--   * fantasy.js, pick.js — never touched `players`.
--
-- DEPLOY THE 9 FILES FIRST, THEN RUN THIS. In the other order every
-- one of those pages goes blank, because PostgREST answers 401 for the
-- whole request rather than dropping a column it cannot read.

-- ── 2. The revoke ───────────────────────────────────────────
revoke all on public.players from anon;
revoke all on public.players from authenticated;
grant  select on public.public_players to anon, authenticated;
notify pgrst, 'reload schema';

-- `revoke ALL`, not `revoke select`. Supabase's default privileges
-- grant anon INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER
-- on new tables in `public` as well. Revoking select alone would leave
-- anon able to write to the members table — and the probe confirmed
-- anon held insert, update and delete on `players` today.

-- ── 3. What anon can reach right now ────────────────────────
-- Read-only. Run it before and after.
select
  c.relname                                            as object,
  c.relkind                                            as kind,
  has_table_privilege('anon', c.oid, 'select') as anon_select,
  has_table_privilege('anon', c.oid, 'insert') as anon_insert,
  has_table_privilege('anon', c.oid, 'update') as anon_update,
  has_table_privilege('anon', c.oid, 'delete') as anon_delete
from   pg_class c
join   pg_namespace n on n.oid = c.relnamespace
where  n.nspname = 'public' and c.relname in ('players', 'public_players')
order  by c.relname;

-- ── 4. The columns that matter, named ───────────────────────
-- Anything listed here is readable by anyone with the anon key today.
select a.attname as anon_can_read_this_column_of_players
from   pg_attribute a
join   pg_class c on c.oid = a.attrelid
join   pg_namespace n on n.oid = c.relnamespace
where  n.nspname = 'public' and c.relname = 'players'
  and  a.attnum > 0 and not a.attisdropped
  and  has_column_privilege('anon', c.oid, a.attname, 'select')
  and  a.attname in ('dob','is_minor','media_consent','email','phone',
                     'guardian_name','guardian_phone','guardian_relationship',
                     'photo_url','id_number','address')
order  by a.attname;

-- ── 5. How many youth members this is about ─────────────────
select count(*)                                                  as youth_total,
       count(*) filter (where photo_url is not null)              as with_photo,
       count(*) filter (where photo_url is not null
                         and coalesce(media_consent,false) = false) as photo_no_consent
from   public.players
where  squad = 'youth' and active is not false;
