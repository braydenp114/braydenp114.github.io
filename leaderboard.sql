-- Free throw leaderboard for braydenp114.github.io
-- Run this once in the Supabase SQL editor, then paste the project URL and
-- anon key into the ONLINE settings at the top of game.js.
--
-- Visitors can read scores and add new ones. Nobody can edit or delete a
-- score through the public key; you manage rows from the Supabase dashboard.

create table if not exists public.scores (
  id bigint generated always as identity primary key,
  initials text not null,
  score integer not null,
  created_at timestamptz not null default now(),

  -- Exactly three capital letters, nothing else
  constraint initials_three_letters check (initials ~ '^[A-Z]{3}$'),
  -- Same blocklist as game.js
  constraint initials_not_blocked check (initials not in (
    'ASS', 'CNT', 'CUM', 'DIC', 'DIK', 'FAG', 'FCK', 'FUC', 'FUK', 'KKK',
    'KYS', 'NAZ', 'NGR', 'NIG', 'PIS', 'SEX', 'SHT', 'TIT', 'WTF', 'XXX'
  )),
  -- A 45 second round cannot realistically pass this
  constraint score_in_range check (score between 0 and 200)
);

create index if not exists scores_rank on public.scores (score desc, created_at asc);

alter table public.scores enable row level security;

drop policy if exists "Anyone can read scores" on public.scores;
create policy "Anyone can read scores"
  on public.scores for select
  to anon
  using (true);

drop policy if exists "Anyone can add a score" on public.scores;
create policy "Anyone can add a score"
  on public.scores for insert
  to anon
  with check (true);

-- Only the columns a visitor may set; id and created_at are filled by the database
revoke all on public.scores from anon;
grant select on public.scores to anon;
grant insert (initials, score) on public.scores to anon;
