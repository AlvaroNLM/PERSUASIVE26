-- Execute once in the Supabase SQL editor. All writes go through the Edge Function.
create table public.experiment_sessions (
 session_id uuid primary key,
 participant_id uuid not null unique,
 token_hash text not null,
 experiment_version text not null,
 case_version text not null,
 pre_ai_judgement integer check (pre_ai_judgement between 1 and 7),
 pre_recorded_at timestamptz,
 condition text check (condition in ('XAI','NO_XAI')),
 created_at timestamptz not null default now(),
 test_mode boolean not null default false
);
create table public.experiment_responses (
 id uuid primary key default gen_random_uuid(),
 participant_id uuid not null unique,
 session_id uuid not null unique references public.experiment_sessions(session_id),
 condition text not null check (condition in ('XAI','NO_XAI')),
 created_at timestamptz not null,
 submitted_at timestamptz not null default now(),
 case_attention integer not null check (case_attention between 0 and 4),
 case_distractibility integer not null check (case_distractibility between 0 and 4),
 case_impulsivity integer not null check (case_impulsivity between 0 and 4),
 case_changes integer not null check (case_changes between 0 and 4),
 case_social_communication integer not null check (case_social_communication between 0 and 4),
 case_repetitive_behaviours integer not null check (case_repetitive_behaviours between 0 and 4),
 pre_ai_judgement integer not null check (pre_ai_judgement between 1 and 7),
 post_ai_judgement integer not null check (post_ai_judgement between 1 and 7),
 case_version text not null,
 classification text not null check (classification = 'ADHD_RELATED'),
 explanation_factors jsonb not null,
 a1 integer not null check (a1 between 1 and 7),
 a2 integer not null check (a2 between 1 and 7),
 a3 integer not null check (a3 between 1 and 7),
 a4 integer not null check (a4 between 1 and 7),
 t1 integer not null check (t1 between 1 and 7),
 t2 integer not null check (t2 between 1 and 7),
 tr1 integer not null check (tr1 between 1 and 7),
 tr2 integer not null check (tr2 between 1 and 7),
 rp1 integer not null check (rp1 between 1 and 7),
 rp2 integer not null check (rp2 between 1 and 7),
 rp3 integer not null check (rp3 between 1 and 7),
 u1 integer not null check (u1 between 1 and 7),
 mc1 integer not null check (mc1 between 1 and 7),
 duration_seconds integer not null check (duration_seconds >= 0),
 user_agent text,
 screen_width integer,
 screen_height integer,
 language text,
 ip_hash text check (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$'),
 experiment_version text not null,
 classifier_version text not null,
 test_mode boolean not null default false
);
create index experiment_ip_hash_idx on public.experiment_responses(ip_hash) where ip_hash is not null;
-- A separate claim makes optional hash blocking atomic under concurrent requests.
create table public.experiment_ip_claims (ip_hash text primary key, session_id uuid not null unique);
create table public.experiment_rate_limits (bucket timestamptz primary key, hits integer not null);
create function public.consume_experiment_rate_limit(max_requests integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
 delete from experiment_rate_limits where bucket < now() - interval '2 minutes';
 insert into experiment_rate_limits(bucket, hits) values(date_trunc('minute', now()),1)
 on conflict(bucket) do update set hits = experiment_rate_limits.hits + 1 returning hits into n;
 return n <= max_requests;
end; $$;
revoke all on function public.consume_experiment_rate_limit(integer) from public, anon, authenticated;
grant execute on function public.consume_experiment_rate_limit(integer) to service_role;
alter table public.experiment_sessions enable row level security;
revoke all on public.experiment_sessions from anon, authenticated;
grant all on public.experiment_sessions to service_role;
alter table public.experiment_responses enable row level security;
revoke all on public.experiment_responses from anon, authenticated;
grant all on public.experiment_responses to service_role;
alter table public.experiment_rate_limits enable row level security;
revoke all on public.experiment_rate_limits from anon, authenticated;
grant all on public.experiment_rate_limits to service_role;
alter table public.experiment_ip_claims enable row level security;
revoke all on public.experiment_ip_claims from anon, authenticated;
grant all on public.experiment_ip_claims to service_role;

create function public.lock_experiment_pre(p_session_id uuid, p_token_hash text, p_pre integer, p_condition text)
returns table(pre_ai_judgement integer, condition text)
language plpgsql security definer set search_path = public as $$
begin
 if p_pre is null or p_pre not between 1 and 7 or p_condition is null or p_condition not in ('XAI','NO_XAI') then
  raise exception 'Invalid initial judgement';
 end if;
 update experiment_sessions s
 set pre_ai_judgement = p_pre, condition = p_condition, pre_recorded_at = now()
 where s.session_id = p_session_id and s.token_hash = p_token_hash
  and s.experiment_version = '1.1.0' and s.pre_ai_judgement is null;
 return query select s.pre_ai_judgement, s.condition from experiment_sessions s
 where s.session_id = p_session_id and s.token_hash = p_token_hash and s.experiment_version = '1.1.0';
end; $$;
revoke all on function public.lock_experiment_pre(uuid,text,integer,text) from public, anon, authenticated;
grant execute on function public.lock_experiment_pre(uuid,text,integer,text) to service_role;
create function public.protect_experiment_pre() returns trigger
language plpgsql set search_path = public as $$
begin
 if old.pre_ai_judgement is not null and
  (new.pre_ai_judgement is distinct from old.pre_ai_judgement or new.condition is distinct from old.condition) then
  raise exception 'Initial judgement and assignment are locked';
 end if;
 return new;
end; $$;
create trigger protect_experiment_pre before update on public.experiment_sessions
 for each row execute function public.protect_experiment_pre();
