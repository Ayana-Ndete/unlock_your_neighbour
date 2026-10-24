-- Phase 1: core game data and row-level security.
-- The service-role key bypasses RLS and must only be used in server-side code.

create extension if not exists pgcrypto;

create table public.games (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active' check (status in ('active', 'ended')),
  winner_limit integer not null default 3 check (winner_limit > 0),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

-- A reset will end the current game before it creates the next one.
create unique index games_only_one_active_idx
  on public.games (status)
  where status = 'active';

create table public.players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  selfie_url text,
  finished_at timestamptz,
  rank integer check (rank > 0),
  created_at timestamptz not null default now(),
  constraint players_finish_and_rank_match check (
    (finished_at is null and rank is null)
    or (finished_at is not null and rank is not null)
  ),
  constraint players_one_identity_per_game unique (game_id, auth_user_id)
);

create unique index players_one_rank_per_game_idx
  on public.players (game_id, rank)
  where rank is not null;
create index players_game_rank_idx on public.players (game_id, rank);
create index players_game_finished_idx on public.players (game_id, finished_at);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  position integer not null check (position > 0),
  text text not null check (char_length(trim(text)) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint questions_one_position_per_game unique (game_id, position)
);

create index questions_game_position_idx on public.questions (game_id, position);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  answer_text text not null check (char_length(trim(answer_text)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint answers_one_per_player_question unique (player_id, question_id)
);

create index answers_player_idx on public.answers (player_id);
create index answers_question_idx on public.answers (question_id);

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger answers_set_updated_at
  before update on public.answers
  for each row execute function public.set_updated_at();

-- This is intentionally a narrow public projection: no answers or selfie URLs.
create view public.winners
with (security_invoker = false) as
  select game_id, name, rank
  from public.players
  where rank is not null
    and exists (
      select 1 from public.games
      where games.id = players.game_id
        and games.status = 'ended'
    );

alter table public.games enable row level security;
alter table public.players enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;

-- Keep browser clients away from all private columns and game administration.
revoke all on public.games, public.players, public.questions, public.answers
  from anon, authenticated;
grant select on public.games, public.questions to authenticated;
grant insert (game_id, auth_user_id, name) on public.players to authenticated;
grant select on public.players to authenticated;
grant update (selfie_url) on public.players to authenticated;
grant select on public.answers to authenticated;
grant insert (player_id, question_id, answer_text) on public.answers to authenticated;
grant update (answer_text) on public.answers to authenticated;

-- Game status and questions are safe for a participant to read.
create policy "participants can read games"
  on public.games for select to authenticated using (true);

create policy "participants can read questions"
  on public.questions for select to authenticated using (true);

-- A device session may create and access its own player record only.
create policy "players can create their own row"
  on public.players for insert to authenticated
  with check (auth.uid() = auth_user_id);

create policy "players can read their own row"
  on public.players for select to authenticated
  using (auth.uid() = auth_user_id);

create policy "players can update their own unfinished row"
  on public.players for update to authenticated
  using (auth.uid() = auth_user_id and finished_at is null)
  with check (auth.uid() = auth_user_id);

create policy "players can read and write their own answers"
  on public.answers for all to authenticated
  using (
    exists (
      select 1 from public.players
      join public.questions on questions.id = answers.question_id
      where players.id = answers.player_id
        and players.auth_user_id = auth.uid()
        and players.game_id = questions.game_id
    )
  )
  with check (
    exists (
      select 1 from public.players
      join public.questions on questions.id = answers.question_id
      where players.id = answers.player_id
        and players.auth_user_id = auth.uid()
        and players.game_id = questions.game_id
    )
  );

grant select on public.winners to authenticated;

-- Initial event game. Add questions through the protected admin tooling in Phase 6.
insert into public.games (status, winner_limit)
values ('active', 3);
