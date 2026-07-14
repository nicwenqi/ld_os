alter table public.department_aliases
  add column source_batch_id uuid,
  add column source_sheet text,
  add column source_row_count integer not null default 0 check (source_row_count >= 0),
  add constraint department_aliases_source_batch_scope_fkey
    foreign key (source_batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict;

alter table public.position_aliases
  add column source_batch_id uuid,
  add column source_sheet text,
  add column source_row_count integer not null default 0 check (source_row_count >= 0),
  add constraint position_aliases_source_batch_scope_fkey
    foreign key (source_batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict;

create index department_aliases_source_batch_idx on public.department_aliases(property_id, source_batch_id) where source_batch_id is not null;
create index position_aliases_source_batch_idx on public.position_aliases(property_id, source_batch_id) where source_batch_id is not null;

create or replace function public.complete_property_initialization(p_property_id uuid, p_expected_version bigint default null) returns void language plpgsql security definer set search_path = '' as $$
declare v_settings public.property_settings%rowtype; v_steps integer;
begin
  select * into v_settings from public.property_settings where property_id=p_property_id for update;
  if v_settings.id is null or not app_private.can_manage_property(p_property_id) then raise exception 'P4010: property initialization access denied' using errcode = 'P4010'; end if;
  if p_expected_version is not null and p_expected_version <> v_settings.version then raise exception 'P4011: initialization progress is stale' using errcode = 'P4011'; end if;
  if not exists(select 1 from public.properties p where p.id=p_property_id and btrim(p.name_zh)<>'' and btrim(p.name_en)<>'' and btrim(p.code)<>'' and btrim(p.brand)<>'' and btrim(p.city)<>'' and btrim(p.timezone)<>'') then raise exception 'P4012: hotel identity is incomplete' using errcode = 'P4012'; end if;
  if not exists(select 1 from public.departments d where d.property_id=p_property_id and d.is_active) or not exists(select 1 from public.positions p where p.property_id=p_property_id and p.is_active) then raise exception 'P4013: organization or positions are incomplete' using errcode = 'P4013'; end if;
  if not exists(select 1 from public.import_batches b where b.property_id=p_property_id and b.import_type='employee_master' and b.status in ('mapping_required','validating','ready_for_review','completed','completed_with_warnings')) then raise exception 'P4014: employee workbook has not been inspected' using errcode = 'P4014'; end if;
  if exists(select 1 from public.department_aliases a where a.property_id=p_property_id and a.resolution_type='deferred' and a.is_active) or exists(select 1 from public.position_aliases a where a.property_id=p_property_id and a.resolution_status='deferred' and a.is_active) then raise exception 'P4015: required source labels remain deferred' using errcode = 'P4015'; end if;
  if not exists(
    select 1 from public.user_accounts account
    join public.property_memberships membership on membership.property_id=account.property_id and membership.user_id=account.user_id and membership.status='active'
    join public.role_assignments assignment on assignment.property_id=account.property_id and assignment.user_id=account.user_id and assignment.status='active'
    join public.roles role on role.id=assignment.role_id and role.code='property_ld_manager' and role.is_active
    where account.property_id=p_property_id and account.account_status='active'
  ) then raise exception 'P4017: active property administrator is required' using errcode = 'P4017'; end if;
  select count(*) into v_steps from public.property_initialization_steps s where s.property_id=p_property_id and s.step_key in ('organization','positions','upload','mapping','access') and s.explicitly_confirmed;
  if v_steps <> 5 then raise exception 'P4016: required setup confirmations are incomplete' using errcode = 'P4016'; end if;
  update public.property_settings set initialization_state='ready', initialization_completed_at=now(), initialization_completed_by=auth.uid(), initialization_last_active_step=8, updated_by=auth.uid() where property_id=p_property_id;
end;
$$;

revoke all on function public.complete_property_initialization(uuid,bigint) from public, anon;
grant execute on function public.complete_property_initialization(uuid,bigint) to authenticated;
