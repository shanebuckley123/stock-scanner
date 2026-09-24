-- =====================================================================
-- Flow Clock — trial schema
-- Run in Supabase: SQL Editor > New query > paste > Run
-- (or `supabase db push` if you use the Supabase CLI).
--
-- Security model (trial):
--   * The browser uses the public anon key.
--   * Anon can READ jobs / cards / assignments / attendance / job_time /
--     supplements (needed for the board + realtime). Anon can read techs'
--     id/name/role/active only — never pin_hash.
--   * Anon can NOT write to any table directly. Every write goes through a
--     SECURITY DEFINER function below that checks a session token, which is
--     only issued after a correct name + 4-digit PIN (login()).
--   * PINs are bcrypt-hashed (pgcrypto). 5 wrong PINs locks a tech for 5 min.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table if not exists public.techs (
  id               bigint generated always as identity primary key,
  name             text not null unique,
  pin_hash         text not null,
  role             text not null default 'tech' check (role in ('tech', 'admin')),
  active           boolean not null default true,
  failed_pin_count int not null default 0,
  locked_until     timestamptz,
  created_at       timestamptz not null default now()
);

create table if not exists public.jobs (
  id             bigint generated always as identity primary key,
  job_number     text not null unique,
  -- Hook for iBodyshop integration (out of scope for trial): jobs are keyed
  -- manually today; a future sync can upsert on ibodyshop_ref.
  ibodyshop_ref  text,
  rego           text,
  make_model     text,
  customer_name  text,
  stage          text not null default 'Arrived',
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.cards (
  id     int primary key check (id > 0),
  label  text
);

create table if not exists public.card_assignments (
  id           bigint generated always as identity primary key,
  card_id      int not null references public.cards(id),
  job_id       bigint not null references public.jobs(id) on delete cascade,
  assigned_at  timestamptz not null default now(),
  released_at  timestamptz            -- null = active
);
-- Only one active assignment per card, and per job.
create unique index if not exists card_assignments_active_card
  on public.card_assignments(card_id) where released_at is null;
create unique index if not exists card_assignments_active_job
  on public.card_assignments(job_id) where released_at is null;

create table if not exists public.attendance (
  id         bigint generated always as identity primary key,
  tech_id    bigint not null references public.techs(id),
  clock_in   timestamptz not null default now(),
  clock_out  timestamptz
);
create unique index if not exists attendance_one_open
  on public.attendance(tech_id) where clock_out is null;
create index if not exists attendance_clock_in on public.attendance(clock_in);

create table if not exists public.job_time (
  id          bigint generated always as identity primary key,
  tech_id     bigint not null references public.techs(id),
  job_id      bigint not null references public.jobs(id) on delete cascade,
  task        text not null check (task in
                ('Strip','Panel','Prep','Paint','Polish','Mechanical','Detail','Other')),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);
-- RULE: a tech can only be on one job at a time.
create unique index if not exists job_time_one_open
  on public.job_time(tech_id) where ended_at is null;
create index if not exists job_time_job on public.job_time(job_id);

create table if not exists public.supplements (
  id          uuid primary key default gen_random_uuid(),  -- client-generated so retries are idempotent
  job_id      bigint not null references public.jobs(id) on delete cascade,
  tech_id     bigint not null references public.techs(id),
  kind        text not null check (kind in ('photo','video','voice','text')),
  file_url    text,
  file_path   text,       -- path inside the "supplements" storage bucket
  mime_type   text,
  note        text,
  status      text not null default 'new' check (status in ('new','reviewed','sent')),
  created_at  timestamptz not null default now()
  -- Hook for AI processing (out of scope for trial): add columns such as
  -- transcript text, ai_parts jsonb, ai_processed_at timestamptz, and
  -- attach a Supabase Database Webhook on INSERT -> Edge Function that
  -- transcribes voice / extracts a parts list from photos & video.
);
create index if not exists supplements_job on public.supplements(job_id, created_at desc);
create index if not exists supplements_created on public.supplements(created_at desc);

-- Login sessions (one per phone). Never readable by anon.
create table if not exists public.tech_sessions (
  token        uuid primary key default gen_random_uuid(),
  tech_id      bigint not null references public.techs(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '180 days'
);

-- ---------------------------------------------------------------------
-- Privileges + RLS
-- ---------------------------------------------------------------------

alter table public.techs            enable row level security;
alter table public.jobs             enable row level security;
alter table public.cards            enable row level security;
alter table public.card_assignments enable row level security;
alter table public.attendance       enable row level security;
alter table public.job_time         enable row level security;
alter table public.supplements      enable row level security;
alter table public.tech_sessions    enable row level security;

revoke all on public.techs, public.jobs, public.cards, public.card_assignments,
  public.attendance, public.job_time, public.supplements, public.tech_sessions
  from anon, authenticated;

grant select on public.jobs, public.cards, public.card_assignments,
  public.attendance, public.job_time, public.supplements
  to anon, authenticated;
grant select (id, name, role, active) on public.techs to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['techs','jobs','cards','card_assignments','attendance','job_time','supplements'] loop
    execute format('drop policy if exists "read all" on public.%I', t);
    execute format('create policy "read all" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- Realtime for the /board screen.
do $$
declare t text;
begin
  foreach t in array array['attendance','job_time','supplements','card_assignments','jobs'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Storage bucket for supplement media
-- Public bucket so the board can preview media by URL. File names are
-- random UUIDs. Anyone holding the anon key may upload (trial trade-off).
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('supplements', 'supplements', true, 52428800)   -- 50 MB
on conflict (id) do nothing;

drop policy if exists "supplements upload" on storage.objects;
create policy "supplements upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'supplements');

-- ---------------------------------------------------------------------
-- Internal helpers (not callable by anon)
-- ---------------------------------------------------------------------

create or replace function public._session_tech(p_token uuid)
returns public.techs
language plpgsql security definer set search_path = public
as $$
declare v public.techs;
begin
  select t.* into v
  from public.tech_sessions s join public.techs t on t.id = s.tech_id
  where s.token = p_token and s.expires_at > now() and t.active;
  if not found then
    raise exception 'SESSION_INVALID';
  end if;
  update public.tech_sessions set last_seen_at = now()
  where token = p_token and last_seen_at < now() - interval '1 hour';
  return v;
end $$;

create or replace function public._admin_tech(p_token uuid)
returns public.techs
language plpgsql security definer set search_path = public
as $$
declare v public.techs;
begin
  v := public._session_tech(p_token);
  if v.role <> 'admin' then
    raise exception 'NOT_ADMIN';
  end if;
  return v;
end $$;

-- Status snapshot for one tech: open attendance + open job_time (+ job).
create or replace function public._tech_status(p_tech_id bigint)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'attendance', (select to_jsonb(a) from public.attendance a
                   where a.tech_id = p_tech_id and a.clock_out is null),
    'job_time',   (select to_jsonb(jt) || jsonb_build_object(
                            'job_number', j.job_number, 'rego', j.rego,
                            'make_model', j.make_model)
                   from public.job_time jt join public.jobs j on j.id = jt.job_id
                   where jt.tech_id = p_tech_id and jt.ended_at is null)
  );
$$;

revoke all on function public._session_tech(uuid) from public, anon, authenticated;
revoke all on function public._admin_tech(uuid) from public, anon, authenticated;
revoke all on function public._tech_status(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Public API (called from the app with supabase.rpc)
-- ---------------------------------------------------------------------

-- Name + PIN -> session token.
create or replace function public.login(p_tech_id bigint, p_pin text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v public.techs; v_token uuid;
begin
  select * into v from public.techs where id = p_tech_id and active for update;
  if not found then
    raise exception 'BAD_PIN';
  end if;
  if v.locked_until is not null and v.locked_until > now() then
    raise exception 'LOCKED';
  end if;
  if v.pin_hash <> extensions.crypt(p_pin, v.pin_hash) then
    update public.techs
      set failed_pin_count = failed_pin_count + 1,
          locked_until = case when failed_pin_count + 1 >= 5
                              then now() + interval '5 minutes' else null end
    where id = v.id;
    -- Commit the counter even though we signal failure: return, don't raise.
    return jsonb_build_object('ok', false, 'error', 'BAD_PIN');
  end if;
  update public.techs set failed_pin_count = 0, locked_until = null where id = v.id;
  insert into public.tech_sessions(tech_id) values (v.id) returning token into v_token;
  return jsonb_build_object('ok', true, 'token', v_token,
    'tech', jsonb_build_object('id', v.id, 'name', v.name, 'role', v.role));
end $$;

create or replace function public.logout(p_token uuid)
returns void
language sql security definer set search_path = public
as $$ delete from public.tech_sessions where token = p_token; $$;

-- Who am I + am I clocked in + which job am I on.
create or replace function public.my_status(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v public.techs;
begin
  v := public._session_tech(p_token);
  return jsonb_build_object('tech', jsonb_build_object('id', v.id, 'name', v.name, 'role', v.role))
         || public._tech_status(v.id);
end $$;

-- Daily attendance. p_action is explicit ('in' | 'out') so a double tap or a
-- retry after bad signal can never flip the state twice.
create or replace function public.clock(p_token uuid, p_action text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v public.techs; v_row public.attendance; v_closed int := 0;
begin
  v := public._session_tech(p_token);
  perform pg_advisory_xact_lock(v.id);

  select * into v_row from public.attendance where tech_id = v.id and clock_out is null;

  if p_action = 'in' then
    if found then
      return jsonb_build_object('status', 'already_in', 'at', v_row.clock_in);
    end if;
    insert into public.attendance(tech_id) values (v.id) returning * into v_row;
    return jsonb_build_object('status', 'clocked_in', 'at', v_row.clock_in);

  elsif p_action = 'out' then
    -- RULE: clocking out also closes any open job_time.
    update public.job_time set ended_at = now()
    where tech_id = v.id and ended_at is null;
    get diagnostics v_closed = row_count;
    if v_row.id is null then
      return jsonb_build_object('status', 'not_in', 'closed_jobs', v_closed);
    end if;
    update public.attendance set clock_out = now() where id = v_row.id returning * into v_row;
    return jsonb_build_object('status', 'clocked_out', 'at', v_row.clock_out,
                              'clock_in', v_row.clock_in, 'closed_jobs', v_closed);
  end if;
  raise exception 'BAD_ACTION';
end $$;

-- Start work on a job. If the tech is on another job and p_force is false,
-- returns status 'conflict' so the app can ask for confirmation.
create or replace function public.job_clock_on(p_token uuid, p_job_id bigint, p_task text, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v public.techs;
  v_open public.job_time;
  v_other public.jobs;
  v_new public.job_time;
  v_auto_in boolean := false;
  v_switched jsonb := null;
begin
  v := public._session_tech(p_token);
  perform pg_advisory_xact_lock(v.id);

  if not exists (select 1 from public.jobs where id = p_job_id) then
    raise exception 'NO_JOB';
  end if;

  select * into v_open from public.job_time where tech_id = v.id and ended_at is null;
  if found then
    if v_open.job_id = p_job_id and v_open.task = p_task then
      return jsonb_build_object('status', 'already', 'started_at', v_open.started_at);
    end if;
    if v_open.job_id <> p_job_id and not p_force then
      select * into v_other from public.jobs where id = v_open.job_id;
      return jsonb_build_object('status', 'conflict',
        'other', jsonb_build_object('job_id', v_other.id, 'job_number', v_other.job_number,
                                    'rego', v_other.rego, 'task', v_open.task,
                                    'started_at', v_open.started_at));
    end if;
    update public.job_time set ended_at = now() where id = v_open.id;
    select * into v_other from public.jobs where id = v_open.job_id;
    v_switched := jsonb_build_object('job_number', v_other.job_number, 'task', v_open.task);
  end if;

  -- Forgot to tap the office tag? Clock them in for the day automatically.
  if not exists (select 1 from public.attendance where tech_id = v.id and clock_out is null) then
    insert into public.attendance(tech_id) values (v.id);
    v_auto_in := true;
  end if;

  insert into public.job_time(tech_id, job_id, task) values (v.id, p_job_id, p_task)
  returning * into v_new;

  return jsonb_build_object('status', 'started', 'started_at', v_new.started_at,
                            'task', v_new.task, 'switched_from', v_switched,
                            'auto_clocked_in', v_auto_in);
end $$;

create or replace function public.job_clock_off(p_token uuid, p_job_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v public.techs; v_row public.job_time;
begin
  v := public._session_tech(p_token);
  update public.job_time set ended_at = now()
  where tech_id = v.id and job_id = p_job_id and ended_at is null
  returning * into v_row;
  if not found then
    return jsonb_build_object('status', 'not_on');
  end if;
  return jsonb_build_object('status', 'stopped', 'task', v_row.task,
                            'started_at', v_row.started_at, 'ended_at', v_row.ended_at);
end $$;

-- Record a supplement. The media file is uploaded to storage first; p_id is
-- generated on the phone so a retried upload never creates a duplicate row.
create or replace function public.add_supplement(
  p_token uuid, p_id uuid, p_job_id bigint, p_kind text,
  p_file_url text default null, p_file_path text default null,
  p_mime_type text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v public.techs;
begin
  v := public._session_tech(p_token);
  if p_kind = 'text' and coalesce(btrim(p_note), '') = '' then
    raise exception 'EMPTY_NOTE';
  end if;
  if p_kind <> 'text' and p_file_url is null then
    raise exception 'NO_FILE';
  end if;
  insert into public.supplements(id, job_id, tech_id, kind, file_url, file_path, mime_type, note)
  values (p_id, p_job_id, v.id, p_kind, p_file_url, p_file_path, p_mime_type, nullif(btrim(p_note), ''))
  on conflict (id) do nothing;
  return jsonb_build_object('status', 'saved', 'id', p_id);
end $$;

-- ---- Admin ----------------------------------------------------------

create or replace function public.set_supplement_status(p_token uuid, p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public._admin_tech(p_token);
  update public.supplements set status = p_status where id = p_id;
end $$;

-- Create (no id) or update (with id) a job.
create or replace function public.save_job(p_token uuid, p_job jsonb)
returns public.jobs
language plpgsql security definer set search_path = public
as $$
declare v_row public.jobs;
begin
  perform public._admin_tech(p_token);
  if coalesce(btrim(p_job->>'job_number'), '') = '' then
    raise exception 'JOB_NUMBER_REQUIRED';
  end if;
  if p_job->>'id' is null then
    insert into public.jobs(job_number, ibodyshop_ref, rego, make_model, customer_name, stage, notes)
    values (btrim(p_job->>'job_number'), p_job->>'ibodyshop_ref', upper(p_job->>'rego'),
            p_job->>'make_model', p_job->>'customer_name',
            coalesce(nullif(p_job->>'stage', ''), 'Arrived'), p_job->>'notes')
    returning * into v_row;
  else
    update public.jobs set
      job_number    = btrim(p_job->>'job_number'),
      ibodyshop_ref = p_job->>'ibodyshop_ref',
      rego          = upper(p_job->>'rego'),
      make_model    = p_job->>'make_model',
      customer_name = p_job->>'customer_name',
      stage         = coalesce(nullif(p_job->>'stage', ''), stage),
      notes         = p_job->>'notes',
      updated_at    = now()
    where id = (p_job->>'id')::bigint
    returning * into v_row;
  end if;
  return v_row;
exception when unique_violation then
  raise exception 'JOB_NUMBER_TAKEN';
end $$;

-- Link a card to a job. Without p_force it refuses if the card is on another
-- job or the job already has a card; with p_force it releases those first.
create or replace function public.assign_card(p_token uuid, p_card_id int, p_job_id bigint, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_card public.card_assignments; v_job public.card_assignments; v_num text;
begin
  perform public._admin_tech(p_token);
  perform pg_advisory_xact_lock(424242);   -- serialise card changes (tiny volume)

  if not exists (select 1 from public.cards where id = p_card_id) then
    raise exception 'NO_CARD';
  end if;

  select * into v_card from public.card_assignments where card_id = p_card_id and released_at is null;
  select * into v_job  from public.card_assignments where job_id  = p_job_id  and released_at is null;

  if v_card.id is not null and v_card.job_id = p_job_id then
    return jsonb_build_object('status', 'already');
  end if;
  if not p_force then
    if v_card.id is not null then
      select job_number into v_num from public.jobs where id = v_card.job_id;
      return jsonb_build_object('status', 'card_busy', 'job_number', v_num);
    end if;
    if v_job.id is not null then
      return jsonb_build_object('status', 'job_has_card', 'card_id', v_job.card_id);
    end if;
  end if;

  update public.card_assignments set released_at = now()
  where released_at is null and (card_id = p_card_id or job_id = p_job_id);

  insert into public.card_assignments(card_id, job_id) values (p_card_id, p_job_id);
  return jsonb_build_object('status', 'assigned');
end $$;

create or replace function public.release_card(p_token uuid, p_card_id int, p_mark_delivered boolean default true)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_row public.card_assignments;
begin
  perform public._admin_tech(p_token);
  update public.card_assignments set released_at = now()
  where card_id = p_card_id and released_at is null
  returning * into v_row;
  if not found then
    return jsonb_build_object('status', 'not_assigned');
  end if;
  if p_mark_delivered then
    update public.jobs set stage = 'Delivered', updated_at = now() where id = v_row.job_id;
    -- Anyone still clocked on a delivered job gets clocked off it.
    update public.job_time set ended_at = now() where job_id = v_row.job_id and ended_at is null;
  end if;
  return jsonb_build_object('status', 'released', 'job_id', v_row.job_id);
end $$;

grant execute on function
  public.login(bigint, text),
  public.logout(uuid),
  public.my_status(uuid),
  public.clock(uuid, text),
  public.job_clock_on(uuid, bigint, text, boolean),
  public.job_clock_off(uuid, bigint),
  public.add_supplement(uuid, uuid, bigint, text, text, text, text, text),
  public.set_supplement_status(uuid, uuid, text),
  public.save_job(uuid, jsonb),
  public.assign_card(uuid, int, bigint, boolean),
  public.release_card(uuid, int, boolean)
to anon, authenticated;
