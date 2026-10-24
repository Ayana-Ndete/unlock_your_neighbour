-- Phase 5: atomically record a finish and notify every connected participant.

create or replace function public.finish_game(p_player_id uuid)
returns table (outcome text, rank integer, game_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_player public.players%rowtype;
  current_game public.games%rowtype;
  winner_count integer;
  question_count integer;
  answer_count integer;
  assigned_rank integer;
begin
  -- The caller can finish only their own player record.
  select * into current_player
  from public.players
  where id = p_player_id
    and auth_user_id = auth.uid();

  if not found then
    raise exception 'Player not found for this device session';
  end if;

  -- This row lock serializes every finish attempt for this game.
  select * into current_game
  from public.games
  where id = current_player.game_id
  for update;

  if current_player.rank is not null then
    return query select 'already_finished'::text, current_player.rank, current_game.status;
    return;
  end if;

  if current_game.status <> 'active' then
    return query select 'ended'::text, null::integer, current_game.status;
    return;
  end if;

  -- A browser cannot skip the selfie or questions and call this RPC early.
  if current_player.selfie_url is null then
    raise exception 'A selfie is required before finishing';
  end if;

  select count(*) into question_count
  from public.questions
  where game_id = current_game.id;

  select count(*) into answer_count
  from public.answers answers
  join public.questions questions on questions.id = answers.question_id
  where answers.player_id = current_player.id
    and questions.game_id = current_game.id;

  if question_count = 0 or answer_count <> question_count then
    raise exception 'Every question must be answered before finishing';
  end if;

  select count(*) into winner_count
  from public.players
  where game_id = current_game.id
    and rank is not null;

  if winner_count >= current_game.winner_limit then
    -- Defensive repair for a game that was left active unexpectedly.
    update public.games
    set status = 'ended', ended_at = coalesce(ended_at, now())
    where id = current_game.id;
    return query select 'ended'::text, null::integer, 'ended'::text;
    return;
  end if;

  assigned_rank := winner_count + 1;
  update public.players
  set rank = assigned_rank, finished_at = now()
  where id = current_player.id;

  if assigned_rank = current_game.winner_limit then
    update public.games
    set status = 'ended', ended_at = now()
    where id = current_game.id;
    return query select 'won'::text, assigned_rank, 'ended'::text;
  end if;

  return query select 'won'::text, assigned_rank, 'active'::text;
end;
$$;

revoke all on function public.finish_game(uuid) from public;
grant execute on function public.finish_game(uuid) to authenticated;

-- Once a game is ended, clients can no longer change answers directly.
create policy "answers can change only while game is active"
  on public.answers as restrictive for all to authenticated
  using (
    exists (
      select 1
      from public.players
      join public.questions on questions.id = answers.question_id
      join public.games on games.id = players.game_id
      where players.id = answers.player_id
        and games.status = 'active'
    )
  )
  with check (
    exists (
      select 1
      from public.players
      join public.questions on questions.id = answers.question_id
      join public.games on games.id = players.game_id
      where players.id = answers.player_id
        and games.status = 'active'
    )
  );

do $$
begin
  alter publication supabase_realtime add table public.games;
exception
  when duplicate_object then null;
end;
$$;
