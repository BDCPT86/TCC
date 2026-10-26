-- ============================================================
-- 7 — WHAT IS WRONG WITH THE FANTASY PERMISSIONS
--
-- READ-ONLY. Nothing here changes anything. Send me the output and
-- I will give you the repair for whatever it names.
--
-- Three things I did recently could be implicated, and this checks
-- all three:
--
--   1. fantasy_players is a SECURITY DEFINER view — that is how it
--      hides dob while still serving the pick screen. Supabase's
--      advisor flags exactly that pattern as CRITICAL. If the advisor
--      was used to "fix" it, the view now runs as the caller, anon
--      has nothing on `players`, and every fantasy page that needs it
--      dies with 42501 — the same failure the games had this morning.
--      THIS IS THE FIRST THING TO LOOK AT.
--
--   2. 4-tighten-board-grants.sql ran
--         alter default privileges in schema public
--           revoke all on tables from anon, authenticated;
--      I described that as stopping the next GAME view arriving
--      over-granted. It is wider than that: it applies to every table
--      and view created in `public` from then on, by the role that
--      ran it. Existing objects are untouched, but anything created
--      afterwards — fantasy included — arrives with no anon access.
--
--   3. The older sweeps (14, 15, 16) closed columns and function
--      grants across the platform. Section 5 re-checks the functions.
-- ============================================================

-- ── 1. Views: who do they run as? ───────────────────────────
-- fantasy_players MUST be off/default. If it says `on`, that is the
-- bug, and section 6 prints the one line that fixes it.
select c.relname as view_name,
       coalesce((select option_value from pg_options_to_table(c.reloptions)
                 where option_name = 'security_invoker'), 'off (default)') as runs_as,
       case coalesce((select option_value from pg_options_to_table(c.reloptions)
                      where option_name = 'security_invoker'), 'off')
         when 'on' then '<<< SUSPECT'  else 'ok' end as verdict
from   pg_class c
join   pg_namespace n on n.oid = c.relnamespace
where  n.nspname = 'public' and c.relkind = 'v'
  and  c.relname like 'fantasy%'
order  by c.relname;


-- ── 2. Does every object the site reads still exist? ────────
-- A missing row is the answer on its own.
with wanted(name) as (values
  ('fantasy_badges'),('fantasy_chip_usage'),('fantasy_leaderboard_summary'),
  ('fantasy_otps'),('fantasy_participants'),('fantasy_picks'),
  ('fantasy_player_name_map'),('fantasy_players'),('fantasy_round_fixtures'),
  ('fantasy_rounds'),('fantasy_scores'),('players'),('push_subscriptions'))
select w.name,
       case c.relkind when 'r' then 'table' when 'v' then 'view'
                      when 'm' then 'matview' else coalesce(c.relkind::text,'MISSING') end as kind,
       coalesce(c.relrowsecurity::text, '-') as rls
from   wanted w
left join pg_class c on c.relname = w.name
      and c.relnamespace = 'public'::regnamespace
order  by w.name;


-- ── 3. What can anon reach? ─────────────────────────────────
-- The public fantasy pages read with the anon key, so anything the
-- leaderboard, pick screen or profile needs must appear here.
select table_name, string_agg(privilege_type, ', ' order by privilege_type) as anon_has
from   information_schema.role_table_grants
where  grantee = 'anon' and table_schema = 'public'
  and  (table_name like 'fantasy%' or table_name in ('players','push_subscriptions'))
group  by table_name
order  by table_name;


-- ── 4. Actually try it, as anon ─────────────────────────────
-- Grants can look right and still fail: a definer view whose owner
-- lost access, a policy that matches nothing, a missing column.
-- This is the only section that reproduces what the browser sees.
do $$
declare r record; n int;
begin
  set local role anon;
  for r in
    select unnest(array[
      'fantasy_rounds','fantasy_participants','fantasy_picks','fantasy_scores',
      'fantasy_players','fantasy_leaderboard_summary','fantasy_badges',
      'fantasy_chip_usage','fantasy_round_fixtures','fantasy_player_name_map',
      'players']) as t
  loop
    begin
      execute format('select count(*) from public.%I', r.t) into n;
      raise notice '  OK      %  (% rows)', rpad(r.t, 30), n;
    exception when others then
      raise notice '  FAILED  %  %  %', rpad(r.t, 30), sqlstate, sqlerrm;
    end;
  end loop;
  reset role;
end $$;


-- ── 5. Functions the site calls over RPC ────────────────────
-- 16-close-the-functions.sql deliberately closed these to anon. The
-- Worker calls them with the service key, so anon SHOULD be absent.
-- Listed so you can see it rather than assume it.
select p.proname as function_name,
       case when has_function_privilege('anon', p.oid, 'execute')
            then 'anon CAN execute' else 'anon cannot (correct)' end as anon_execute,
       case when has_function_privilege('authenticated', p.oid, 'execute')
            then 'authenticated CAN execute' else 'authenticated cannot' end as auth_execute
from   pg_proc p
join   pg_namespace n on n.oid = p.pronamespace
where  n.nspname = 'public'
  and  p.proname in ('fantasy_replace_round_scores','update_player_values')
order  by p.proname;


-- ── 6. RLS policies on the fantasy tables ───────────────────
-- A table with RLS on and no policy for anon is closed to the public
-- pages, whatever the grants say.
select c.relname as table_name,
       c.relrowsecurity as rls_on,
       coalesce(count(pol.polname) filter (where pol.polname is not null), 0) as policies,
       coalesce(string_agg(pol.polname, ', ' order by pol.polname), '(none)') as policy_names
from   pg_class c
join   pg_namespace n on n.oid = c.relnamespace
left join pg_policy pol on pol.polrelid = c.oid
where  n.nspname = 'public' and c.relkind = 'r'
  and  (c.relname like 'fantasy%' or c.relname in ('players','push_subscriptions'))
group  by c.relname, c.relrowsecurity
order  by c.relname;


-- ── 7. Will a NEWLY created table be readable? ─────────────
-- Asked by doing it, not by reading the catalogue: an empty
-- pg_default_acl means "no explicit default", which is the SAME
-- state whether Supabase's grant was never set or was revoked. The
-- catalogue cannot tell those apart; the behaviour can.
--
-- This creates one scratch table, tests it as anon, and drops it
-- again in the same block, so nothing is left behind.
--
-- If it reports NOT readable, then 4-tighten-board-grants.sql is in
-- the way of anything new you create in public — fantasy included —
-- and any new table needs an explicit `grant select ... to anon`.
do $$
declare n int; readable boolean;
begin
  execute 'create table public.zz_perm_probe (id int)';
  begin
    set local role anon;
    begin
      execute 'select count(*) from public.zz_perm_probe' into n;
      readable := true;
    exception when others then
      readable := false;
    end;
    reset role;
  exception when others then
    reset role;
    readable := false;
  end;
  execute 'drop table if exists public.zz_perm_probe';

  if readable then
    raise notice 'A newly created table IS readable by anon — Supabase''s default grant is still in place.';
  else
    raise notice 'A newly created table is NOT readable by anon.';
    raise notice '  Anything new in public needs an explicit grant. This is what';
    raise notice '  4-tighten-board-grants.sql did, and it is wider than the games.';
  end if;
end $$;

-- For the record, whatever the catalogue holds. Empty is normal.
select pg_get_userbyid(d.defaclrole) as set_by_role,
       n.nspname as schema,
       d.defaclobjtype as obj_type,
       d.defaclacl::text as default_acl
from   pg_default_acl d
join   pg_namespace n on n.oid = d.defaclnamespace
where  n.nspname = 'public';
