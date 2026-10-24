-- Phase 6: server-only helpers used by the password-protected admin function.

create or replace function public.admin_replace_questions(
  p_game_id uuid,
  p_questions jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.games where id = p_game_id) then
    raise exception 'Game not found';
  end if;

  -- Editing questions after participants join could invalidate their answers.
  if exists (select 1 from public.players where game_id = p_game_id) then
    raise exception 'Questions can only be edited before players join';
  end if;

  if jsonb_typeof(p_questions) <> 'array' then
    raise exception 'Questions must be an array';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) item
    where jsonb_typeof(item->'position') <> 'number'
      or char_length(trim(coalesce(item->>'text', ''))) not between 1 and 500
  ) then
    raise exception 'Every question needs a position and text between 1 and 500 characters';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) item
    group by (item->>'position')::integer
    having count(*) > 1
  ) then
    raise exception 'Question positions must be unique';
  end if;

  delete from public.questions where game_id = p_game_id;

  insert into public.questions (game_id, position, text)
  select p_game_id, (item->>'position')::integer, trim(item->>'text')
  from jsonb_array_elements(p_questions) item
  order by (item->>'position')::integer;
end;
$$;

create or replace function public.admin_reset_game()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  source_game public.games%rowtype;
  new_game_id uuid;
begin
  -- Lock the only active game, if one exists, before ending it.
  select * into source_game
  from public.games
  where status = 'active'
  for update;

  if not found then
    select * into source_game
    from public.games
    order by created_at desc
    limit 1;
  end if;

  update public.games
  set status = 'ended', ended_at = coalesce(ended_at, now())
  where status = 'active';

  insert into public.games (status, winner_limit)
  values ('active', coalesce(source_game.winner_limit, 3))
  returning id into new_game_id;

  -- Preserve the question wording for the next round without touching history.
  if source_game.id is not null then
    insert into public.questions (game_id, position, text)
    select new_game_id, position, text
    from public.questions
    where game_id = source_game.id
    order by position;
  end if;

  return new_game_id;
end;
$$;

revoke all on function public.admin_replace_questions(uuid, jsonb) from public;
revoke all on function public.admin_reset_game() from public;
grant execute on function public.admin_replace_questions(uuid, jsonb) to service_role;
grant execute on function public.admin_reset_game() to service_role;
