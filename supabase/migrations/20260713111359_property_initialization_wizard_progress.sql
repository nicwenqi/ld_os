alter table public.property_settings add column initialization_last_active_step smallint not null default 1 check (initialization_last_active_step between 1 and 8);

create table public.property_initialization_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  step_key text not null check (step_key in ('identity','rules','organization','positions','upload','mapping','access')),
  explicitly_confirmed boolean not null default false,
  warning_message text,
  blocking_reason text,
  version bigint not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_initialization_steps_scope_fkey foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint property_initialization_steps_property_step_key unique (property_id, step_key)
);
create index property_initialization_steps_scope_idx on public.property_initialization_steps(tenant_id, property_id);
alter table public.property_initialization_steps enable row level security;
alter table public.property_initialization_steps force row level security;
revoke all on public.property_initialization_steps from anon, authenticated;
grant select, insert, update on public.property_initialization_steps to authenticated;

create or replace function app_private.prevent_initialization_step_scope_change() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.property_id is distinct from old.property_id or new.step_key is distinct from old.step_key then
    raise exception 'initialization step identity is immutable' using errcode = '23514';
  end if;
  new.version := old.version + 1;
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger property_initialization_steps_updated_at before update on public.property_initialization_steps for each row execute function app_private.set_updated_at();
create trigger property_initialization_steps_immutable_scope before update on public.property_initialization_steps for each row execute function app_private.prevent_initialization_step_scope_change();
create policy property_initialization_steps_select on public.property_initialization_steps for select to authenticated using ((select app_private.can_manage_property(property_id)));
create policy property_initialization_steps_insert on public.property_initialization_steps for insert to authenticated with check ((select app_private.can_manage_property(property_id)));
create policy property_initialization_steps_update on public.property_initialization_steps for update to authenticated using ((select app_private.can_manage_property(property_id))) with check ((select app_private.can_manage_property(property_id)));

create or replace function public.get_property_initialization_progress(p_property_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('lastActiveStep', settings.initialization_last_active_step, 'version', settings.version, 'completedAt', settings.initialization_completed_at, 'steps', coalesce(jsonb_object_agg(step.step_key, jsonb_build_object('explicitlyConfirmed', step.explicitly_confirmed, 'warning', step.warning_message, 'blockingReason', step.blocking_reason)) filter (where step.id is not null), '{}'::jsonb))
  from public.property_settings settings left join public.property_initialization_steps step on step.property_id = settings.property_id
  where settings.property_id = p_property_id and app_private.can_manage_property(settings.property_id)
  group by settings.initialization_last_active_step, settings.version, settings.initialization_completed_at;
$$;

create or replace function public.save_property_initialization_step(p_property_id uuid, p_step_key text, p_last_active_step smallint, p_explicitly_confirmed boolean, p_warning text, p_blocking_reason text, p_expected_version bigint default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tenant_id uuid; v_version bigint;
begin
  if p_step_key not in ('identity','rules','organization','positions','upload','mapping','access') or p_last_active_step not between 1 and 8 then raise exception 'P4001: invalid initialization step' using errcode = 'P4001'; end if;
  select tenant_id, version into v_tenant_id, v_version from public.property_settings where property_id = p_property_id for update;
  if v_tenant_id is null or not app_private.can_manage_property(p_property_id) then raise exception 'P4002: property initialization access denied' using errcode = 'P4002'; end if;
  if p_expected_version is not null and p_expected_version <> v_version then raise exception 'P4003: initialization progress is stale' using errcode = 'P4003'; end if;
  insert into public.property_initialization_steps(tenant_id,property_id,step_key,explicitly_confirmed,warning_message,blocking_reason,created_by,updated_by)
  values(v_tenant_id,p_property_id,p_step_key,p_explicitly_confirmed,nullif(btrim(p_warning),''),nullif(btrim(p_blocking_reason),''),auth.uid(),auth.uid())
  on conflict(property_id,step_key) do update set explicitly_confirmed=excluded.explicitly_confirmed, warning_message=excluded.warning_message, blocking_reason=excluded.blocking_reason;
  update public.property_settings set initialization_last_active_step=p_last_active_step, initialization_state='in_progress', updated_by=auth.uid() where property_id=p_property_id;
  return public.get_property_initialization_progress(p_property_id);
end;
$$;

create or replace function public.complete_property_initialization(p_property_id uuid, p_expected_version bigint default null) returns void language plpgsql security definer set search_path = '' as $$
declare v_settings public.property_settings%rowtype; v_steps integer;
begin
  select * into v_settings from public.property_settings where property_id=p_property_id for update;
  if v_settings.id is null or not app_private.can_manage_property(p_property_id) then raise exception 'P4010: property initialization access denied' using errcode = 'P4010'; end if;
  if p_expected_version is not null and p_expected_version <> v_settings.version then raise exception 'P4011: initialization progress is stale' using errcode = 'P4011'; end if;
  if not exists(select 1 from public.properties p where p.id=p_property_id and btrim(p.name_zh)<>'' and btrim(p.name_en)<>'' and btrim(p.code)<>'' and btrim(p.brand)<>'' and btrim(p.city)<>'' and btrim(p.timezone)<>'') then raise exception 'P4012: hotel identity is incomplete' using errcode = 'P4012'; end if;
  if not exists(select 1 from public.departments d where d.property_id=p_property_id and d.is_active) or not exists(select 1 from public.positions p where p.property_id=p_property_id and p.is_active) then raise exception 'P4013: organization or positions are incomplete' using errcode = 'P4013'; end if;
  if not exists(select 1 from public.import_batches b where b.property_id=p_property_id and b.import_type='employee_master' and b.status in ('ready_for_review','completed','completed_with_warnings')) then raise exception 'P4014: employee workbook has not been inspected' using errcode = 'P4014'; end if;
  if exists(select 1 from public.department_aliases a where a.property_id=p_property_id and a.resolution_type='deferred' and a.is_active) or exists(select 1 from public.position_aliases a where a.property_id=p_property_id and a.resolution_status='deferred' and a.is_active) then raise exception 'P4015: required source labels remain deferred' using errcode = 'P4015'; end if;
  select count(*) into v_steps from public.property_initialization_steps s where s.property_id=p_property_id and s.step_key in ('positions','upload','mapping','access') and s.explicitly_confirmed;
  if v_steps <> 4 then raise exception 'P4016: required setup confirmations are incomplete' using errcode = 'P4016'; end if;
  update public.property_settings set initialization_state='ready', initialization_completed_at=now(), initialization_completed_by=auth.uid(), initialization_last_active_step=8, updated_by=auth.uid() where property_id=p_property_id;
end;
$$;

revoke execute on function app_private.prevent_initialization_step_scope_change() from public, anon, authenticated;
revoke all on function public.get_property_initialization_progress(uuid) from public, anon;
revoke all on function public.save_property_initialization_step(uuid,text,smallint,boolean,text,text,bigint) from public, anon;
revoke all on function public.complete_property_initialization(uuid,bigint) from public, anon;
grant execute on function public.get_property_initialization_progress(uuid), public.save_property_initialization_step(uuid,text,smallint,boolean,text,text,bigint), public.complete_property_initialization(uuid,bigint) to authenticated;
