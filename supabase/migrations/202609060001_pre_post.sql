-- Upgrade an existing 1.0.0 database without fabricating pre/post values for old rows.
begin;
alter table public.experiment_sessions alter column condition drop not null;
alter table public.experiment_sessions
 add column experiment_version text not null default '1.0.0',
 add column case_version text,
 add column pre_ai_judgement integer check (pre_ai_judgement between 1 and 7),
 add column pre_recorded_at timestamptz;
alter table public.experiment_responses
 add column pre_ai_judgement integer check (pre_ai_judgement between 1 and 7),
 add column post_ai_judgement integer check (post_ai_judgement between 1 and 7),
 add column case_version text,
 add constraint current_judgements_required check (
  experiment_version <> '1.1.0' or
  (pre_ai_judgement is not null and post_ai_judgement is not null and case_version is not null and case_version = 'alex_v1')
 );
-- Legacy sessions remain version 1.0.0 and cannot resume in 1.1.0.
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
commit;
