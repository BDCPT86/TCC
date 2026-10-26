-- ============================================================
-- 8 — PUT THE FANTASY VIEWS BACK
--
-- Three views are running with security_invoker = on:
--
--   fantasy_players
--   fantasy_leaderboard_summary
--   fantasy_chips_played
--
-- All three were built as owner-rights ("security definer") views on
-- purpose, and all three were working that way. Supabase's advisor
-- flags that pattern as CRITICAL and offers to switch them, which is
-- what has happened.
--
-- Why the switch breaks them: these views exist precisely BECAUSE
-- the public may not touch what they read. fantasy_players is the
-- clearest case — it reads `players`, which holds dob, and anon is
-- given nothing on that table. The view shows id, name and value and
-- filters out juniors. Run it with the caller's rights and there are
-- no rights to run it with, so it fails with 42501.
--
-- Worth being clear about the direction of the failure: switching
-- them LEAKED NOTHING. It removed access rather than granting it.
-- The pages broke; no dob went anywhere.
--
-- Safe to run twice. Read the note at the bottom before you touch
-- the advisor again, or this will come straight back.
-- ============================================================

alter view public.fantasy_players            set (security_invoker = off);
alter view public.fantasy_leaderboard_summary set (security_invoker = off);
alter view public.fantasy_chips_played       set (security_invoker = off);

notify pgrst, 'reload schema';

-- ── 1. All three back to owner rights ───────────────────────
-- Expect runs_as = off (or 'off (default)') on every row.
select c.relname as view_name,
       coalesce((select option_value from pg_options_to_table(c.reloptions)
                 where option_name = 'security_invoker'), 'off (default)') as runs_as
from   pg_class c
join   pg_namespace n on n.oid = c.relnamespace
where  n.nspname = 'public' and c.relkind = 'v' and c.relname like 'fantasy%'
order  by c.relname;


-- ── 2. The thing that was actually broken ───────────────────
-- Reads them as anon, which is what the pages do.
do $$
declare r record; n int;
begin
  set local role anon;
  for r in select unnest(array[
      'fantasy_players','fantasy_leaderboard_summary','fantasy_chips_played']) as t
  loop
    begin
      execute format('select count(*) from public.%I', r.t) into n;
      raise notice '  OK      %  (% rows)', rpad(r.t, 30), n;
    exception when others then
      raise notice '  STILL BROKEN  %  %  %', rpad(r.t, 30), sqlstate, sqlerrm;
    end;
  end loop;
  reset role;
end $$;


-- ── 3. And the tables underneath are still closed ───────────
-- The whole reason for owner-rights views. Expect anon to be shut
-- out of `players` — that is where dob lives.
do $$
declare n int;
begin
  set local role anon;
  begin
    select count(*) into n from public.players;
    raise notice 'PROBLEM: anon can read players directly — dob is exposed';
  exception when others then
    raise notice 'anon correctly cannot read players (dob stays put)';
  end;
  reset role;
end $$;


-- ── 4. Every view on the platform, and how it runs ──────────
-- So you can see which others are owner-rights views and would break
-- the same way if the advisor is applied to them. Check this list
-- against the advisor before accepting any of its fixes.
select c.relname as view_name,
       coalesce((select option_value from pg_options_to_table(c.reloptions)
                 where option_name = 'security_invoker'), 'off (default)') as runs_as
from   pg_class c
join   pg_namespace n on n.oid = c.relnamespace
where  n.nspname = 'public' and c.relkind = 'v'
order  by runs_as, c.relname;


-- ============================================================
-- BEFORE YOU USE THE ADVISOR ON THESE AGAIN
--
-- The warning is not wrong in general. An owner-rights view does
-- bypass RLS, and if one exposes a column it should not, nobody is
-- protected by the table's policies. That is worth flagging.
--
-- It is wrong HERE because the column list is the protection. These
-- views were written to show a safe subset of a table the public
-- cannot open. Switching them to invoker does not make that safer —
-- it just stops them working.
--
-- Two honest ways to resolve it:
--
--   a) Accept the warning and leave the views as owner-rights. Then
--      the rule to hold is: never add a column to one of these views
--      without asking whether the public may see it. The view IS the
--      permission boundary.
--
--   b) Convert properly, one view at a time: security_invoker = on,
--      an RLS policy on the base table, and a COLUMN-LEVEL grant
--      naming every column the view needs and omitting the rest.
--      6-invoker-views-option.sql does this for the games and shows
--      the shape. It is more moving parts and it has a real trap —
--      add a column to the view later and the page breaks with 42501
--      until you grant it too.
--
-- What is not safe is the one-click fix, which does the first half
-- of (b) and none of the second.
-- ============================================================
