-- Recovery C: deterministic employee import state, immutable evidence,
-- guarded commit/reversal, and department-scoped employee directory.

alter table public.import_batches
  add column status_treatment text,
  add column preview_summary jsonb not null default '{}'::jsonb,
  add column previewed_by uuid references auth.users(id) on delete set null,
  add column previewed_at timestamptz,
  add constraint import_batches_status_treatment_check check (
    status_treatment is null
    or status_treatment in (
      'use_recognized_status',
      'retain_existing_set_additions_active'
    )
  ),
  add constraint import_batches_preview_summary_object_check check (
    jsonb_typeof(preview_summary) = 'object'
  );

alter table public.employee_external_identifiers
  add column version bigint not null default 1,
  add constraint employee_external_identifiers_version_check check (version > 0);

alter table public.import_commit_items
  add column identifier_before_snapshots jsonb not null default '[]'::jsonb,
  add column identifier_after_snapshots jsonb not null default '[]'::jsonb,
  add constraint import_commit_items_identifier_before_array_check check (
    jsonb_typeof(identifier_before_snapshots) = 'array'
  ),
  add constraint import_commit_items_identifier_after_array_check check (
    jsonb_typeof(identifier_after_snapshots) = 'array'
  );

alter table public.import_commits
  add column revert_preview_token_hash text,
  add column revert_preview_expires_at timestamptz,
  add column revert_preview_batch_version bigint,
  add column revert_preview_snapshot jsonb,
  add constraint import_commits_revert_preview_check check (
    (
      revert_preview_token_hash is null
      and revert_preview_expires_at is null
      and revert_preview_batch_version is null
      and revert_preview_snapshot is null
    )
    or (
      revert_preview_token_hash is not null
      and revert_preview_expires_at is not null
      and revert_preview_batch_version is not null
      and revert_preview_snapshot is not null
      and jsonb_typeof(revert_preview_snapshot) = 'object'
    )
  );

create table public.import_source_label_resolutions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  import_batch_id uuid not null,
  resolution_type text not null,
  source_label text not null,
  normalized_source_label text not null,
  affected_row_count integer not null default 0,
  decision text not null,
  target_entity_type text,
  target_entity_id uuid,
  approved_by uuid references auth.users(id) on delete restrict,
  decided_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_source_label_resolutions_batch_scope_fkey
    foreign key (import_batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id)
    on delete cascade,
  constraint import_source_label_resolutions_scope_key
    unique (id, tenant_id, property_id),
  constraint import_source_label_resolutions_label_key
    unique (import_batch_id, resolution_type, normalized_source_label),
  constraint import_source_label_resolutions_type_check
    check (resolution_type in ('department','position')),
  constraint import_source_label_resolutions_label_check
    check (
      btrim(source_label) <> ''
      and btrim(normalized_source_label) <> ''
      and affected_row_count > 0
      and version > 0
    ),
  constraint import_source_label_resolutions_decision_check
    check (
      (
        decision = 'mapped'
        and target_entity_type is not null
        and target_entity_id is not null
        and approved_by is not null
        and decided_at is not null
      )
      or (
        decision in ('excluded','deferred')
        and target_entity_type is null
        and target_entity_id is null
        and approved_by is not null
        and decided_at is not null
      )
      or (
        decision = 'pending'
        and target_entity_type is null
        and target_entity_id is null
        and approved_by is null
        and decided_at is null
      )
    ),
  constraint import_source_label_resolutions_target_type_check
    check (
      target_entity_type is null
      or target_entity_type in ('department','operational_unit','position')
    )
);

create table public.import_activity_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  import_batch_id uuid not null,
  event_type text not null,
  from_status public.import_batch_status,
  to_status public.import_batch_status,
  actor_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint import_activity_events_batch_scope_fkey
    foreign key (import_batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id)
    on delete cascade,
  constraint import_activity_events_scope_key
    unique (id, tenant_id, property_id),
  constraint import_activity_events_type_check
    check (btrim(event_type) <> ''),
  constraint import_activity_events_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint import_activity_events_transition_check
    check (
      (from_status is null and to_status is null)
      or to_status is not null
    )
);

create index import_batches_property_type_status_idx
  on public.import_batches(property_id, import_type, status, created_at desc);
create index import_source_label_resolutions_batch_type_status_idx
  on public.import_source_label_resolutions(
    import_batch_id, resolution_type, decision
  );
create index import_activity_events_batch_type_created_idx
  on public.import_activity_events(import_batch_id, event_type, created_at desc);
create index employees_source_batch_idx
  on public.employees(source_batch_id)
  where source_batch_id is not null;
create index employee_external_identifiers_employee_idx
  on public.employee_external_identifiers(employee_id, is_active);
create index employee_external_identifiers_source_batch_idx
  on public.employee_external_identifiers(source_batch_id)
  where source_batch_id is not null;
create index employees_department_directory_idx
  on public.employees(property_id, department_id, employee_number);
create index trainer_scopes_directory_idx
  on public.trainer_scopes(
    role_assignment_id, is_active, department_id, include_descendants
  );

alter table public.import_source_label_resolutions enable row level security;
alter table public.import_source_label_resolutions force row level security;
alter table public.import_activity_events enable row level security;
alter table public.import_activity_events force row level security;

create or replace function app_private.is_active_property_import_manager(
  p_property_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and app_private.is_current_account_active(p_property_id)
    and app_private.has_property_role(
      p_property_id,
      'property_ld_manager'
    )
    and exists (
      select 1
      from public.properties property
      join public.tenants tenant
        on tenant.id = property.tenant_id
       and tenant.status = 'active'
      where property.id = p_property_id
        and property.status = 'active'
    );
$$;

create or replace function app_private.assert_active_property_import_manager(
  p_property_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if not app_private.has_property_role(
    p_property_id,
    'property_ld_manager'
  ) then
    raise exception 'IMPORT_MANAGER_REQUIRED' using errcode = '42501';
  end if;

  if not app_private.is_current_account_active(p_property_id) then
    raise exception 'IMPORT_MANAGER_ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.properties property
    join public.tenants tenant
      on tenant.id = property.tenant_id
     and tenant.status = 'active'
    where property.id = p_property_id
      and property.status = 'active'
  ) then
    raise exception 'IMPORT_MANAGER_PROPERTY_INACTIVE'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function app_private.is_import_batch_transition_allowed(
  p_from_status public.import_batch_status,
  p_to_status public.import_batch_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_from_status = p_to_status
    or (p_from_status = 'uploaded' and p_to_status in ('inspecting','cancelled','failed'))
    or (p_from_status = 'inspecting' and p_to_status in ('mapping_required','validating','cancelled','failed'))
    or (p_from_status = 'mapping_required' and p_to_status in ('inspecting','validating','cancelled','failed'))
    or (p_from_status = 'validating' and p_to_status in ('mapping_required','ready_for_review','cancelled','failed'))
    or (p_from_status = 'ready_for_review' and p_to_status in ('mapping_required','validating','importing','cancelled','failed'))
    or (p_from_status = 'importing' and p_to_status in ('completed','completed_with_warnings','failed'))
    or (p_from_status in ('completed','completed_with_warnings') and p_to_status = 'reverted');
$$;

create or replace function app_private.enforce_import_batch_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
    and not app_private.is_import_batch_transition_allowed(
      old.status,
      new.status
    ) then
    raise exception 'IMPORT_BATCH_TRANSITION_INVALID: % -> %',
      old.status,
      new.status
      using errcode = 'P3100';
  end if;
  return new;
end;
$$;

create or replace function app_private.append_import_activity(
  p_batch public.import_batches,
  p_event_type text,
  p_payload jsonb,
  p_from_status public.import_batch_status default null,
  p_to_status public.import_batch_status default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
begin
  insert into public.import_activity_events(
    tenant_id,
    property_id,
    import_batch_id,
    event_type,
    from_status,
    to_status,
    actor_id,
    payload
  )
  values (
    p_batch.tenant_id,
    p_batch.property_id,
    p_batch.id,
    p_event_type,
    p_from_status,
    p_to_status,
    auth.uid(),
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into event_id;
  return event_id;
end;
$$;

create or replace function app_private.record_import_batch_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform app_private.append_import_activity(
      new,
      'batch_status_changed',
      jsonb_build_object(
        'previousVersion', old.version,
        'currentVersion', new.version
      ),
      old.status,
      new.status
    );
  end if;
  return new;
end;
$$;

create or replace function app_private.bump_employee_identifier_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

create or replace function app_private.reject_import_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'IMPORT_EVIDENCE_APPEND_ONLY' using errcode = '42501';
end;
$$;

drop trigger if exists import_batches_enforce_transition
  on public.import_batches;
create trigger import_batches_enforce_transition
before update of status on public.import_batches
for each row execute function app_private.enforce_import_batch_transition();

drop trigger if exists import_batches_record_transition
  on public.import_batches;
create trigger import_batches_record_transition
after update of status on public.import_batches
for each row execute function app_private.record_import_batch_transition();

drop trigger if exists employee_external_identifiers_bump_version
  on public.employee_external_identifiers;
create trigger employee_external_identifiers_bump_version
before update on public.employee_external_identifiers
for each row execute function app_private.bump_employee_identifier_version();

drop trigger if exists import_commit_items_append_only
  on public.import_commit_items;
create trigger import_commit_items_append_only
before update or delete on public.import_commit_items
for each row execute function app_private.reject_import_evidence_mutation();

drop trigger if exists import_activity_events_append_only
  on public.import_activity_events;
create trigger import_activity_events_append_only
before update or delete on public.import_activity_events
for each row execute function app_private.reject_import_evidence_mutation();

drop policy if exists employees_manager_select on public.employees;
drop policy if exists employees_manager_insert on public.employees;
drop policy if exists employees_manager_update on public.employees;
create policy employees_manager_select
on public.employees for select to authenticated
using ((select app_private.is_active_property_import_manager(property_id)));
create policy employees_manager_insert
on public.employees for insert to authenticated
with check ((select app_private.is_active_property_import_manager(property_id)));
create policy employees_manager_update
on public.employees for update to authenticated
using ((select app_private.is_active_property_import_manager(property_id)))
with check ((select app_private.is_active_property_import_manager(property_id)));

drop policy if exists employee_identifiers_manager_select
  on public.employee_external_identifiers;
drop policy if exists employee_identifiers_manager_insert
  on public.employee_external_identifiers;
drop policy if exists employee_identifiers_manager_update
  on public.employee_external_identifiers;
create policy employee_identifiers_manager_select
on public.employee_external_identifiers for select to authenticated
using ((select app_private.is_active_property_import_manager(property_id)));
create policy employee_identifiers_manager_insert
on public.employee_external_identifiers for insert to authenticated
with check ((select app_private.is_active_property_import_manager(property_id)));
create policy employee_identifiers_manager_update
on public.employee_external_identifiers for update to authenticated
using ((select app_private.is_active_property_import_manager(property_id)))
with check ((select app_private.is_active_property_import_manager(property_id)));

drop policy if exists import_batches_manager_select on public.import_batches;
drop policy if exists import_batches_manager_insert on public.import_batches;
drop policy if exists import_batches_manager_update on public.import_batches;
create policy import_batches_manager_select
on public.import_batches for select to authenticated
using ((select app_private.is_active_property_import_manager(property_id)));
create policy import_batches_manager_insert
on public.import_batches for insert to authenticated
with check ((select app_private.is_active_property_import_manager(property_id)));
create policy import_batches_manager_update
on public.import_batches for update to authenticated
using ((select app_private.is_active_property_import_manager(property_id)))
with check ((select app_private.is_active_property_import_manager(property_id)));

drop policy if exists import_sheets_manager_select on public.import_sheets;
drop policy if exists import_sheets_manager_insert on public.import_sheets;
drop policy if exists import_sheets_manager_update on public.import_sheets;
create policy import_sheets_manager_select
on public.import_sheets for select to authenticated
using ((select app_private.is_active_property_import_manager(property_id)));
create policy import_sheets_manager_insert
on public.import_sheets for insert to authenticated
with check ((select app_private.is_active_property_import_manager(property_id)));
create policy import_sheets_manager_update
on public.import_sheets for update to authenticated
using ((select app_private.is_active_property_import_manager(property_id)))
with check ((select app_private.is_active_property_import_manager(property_id)));

drop policy if exists import_rows_manager_select
  on public.import_source_rows;
drop policy if exists import_rows_manager_insert
  on public.import_source_rows;
drop policy if exists import_rows_manager_update
  on public.import_source_rows;
create policy import_rows_manager_select
on public.import_source_rows for select to authenticated
using ((select app_private.is_active_property_import_manager(property_id)));
create policy import_rows_manager_insert
on public.import_source_rows for insert to authenticated
with check ((select app_private.is_active_property_import_manager(property_id)));
create policy import_rows_manager_update
on public.import_source_rows for update to authenticated
using ((select app_private.is_active_property_import_manager(property_id)))
with check ((select app_private.is_active_property_import_manager(property_id)));

drop policy if exists import_mappings_manager_select
  on public.import_field_mappings;
drop policy if exists import_mappings_manager_insert
  on public.import_field_mappings;
drop policy if exists import_mappings_manager_update
  on public.import_field_mappings;
create policy import_mappings_manager_select
on public.import_field_mappings for select to authenticated
using ((select app_private.is_active_property_import_manager(property_id)));
create policy import_mappings_manager_insert
on public.import_field_mappings for insert to authenticated
with check ((select app_private.is_active_property_import_manager(property_id)));
create policy import_mappings_manager_update
on public.import_field_mappings for update to authenticated
using ((select app_private.is_active_property_import_manager(property_id)))
with check ((select app_private.is_active_property_import_manager(property_id)));

drop policy if exists import_issues_manager_select on public.import_issues;
drop policy if exists import_issues_manager_insert on public.import_issues;
drop policy if exists import_issues_manager_update on public.import_issues;
create policy import_issues_manager_select
on public.import_issues for select to authenticated
using ((select app_private.is_active_property_import_manager(property_id)));
create policy import_issues_manager_insert
on public.import_issues for insert to authenticated
with check ((select app_private.is_active_property_import_manager(property_id)));
create policy import_issues_manager_update
on public.import_issues for update to authenticated
using ((select app_private.is_active_property_import_manager(property_id)))
with check ((select app_private.is_active_property_import_manager(property_id)));

drop policy if exists import_commits_manager_select on public.import_commits;
drop policy if exists import_commits_manager_insert on public.import_commits;
drop policy if exists import_commits_manager_update on public.import_commits;
create policy import_commits_manager_select
on public.import_commits for select to authenticated
using ((select app_private.is_active_property_import_manager(property_id)));

drop policy if exists import_items_manager_select
  on public.import_commit_items;
drop policy if exists import_items_manager_insert
  on public.import_commit_items;
drop policy if exists import_items_manager_update
  on public.import_commit_items;
create policy import_items_manager_select
on public.import_commit_items for select to authenticated
using ((select app_private.is_active_property_import_manager(property_id)));

create policy import_source_label_resolutions_manager_select
on public.import_source_label_resolutions for select to authenticated
using ((select app_private.is_active_property_import_manager(property_id)));
create policy import_source_label_resolutions_manager_stage
on public.import_source_label_resolutions for insert to authenticated
with check (
  (select app_private.is_active_property_import_manager(property_id))
  and decision = 'pending'
  and target_entity_id is null
  and approved_by is null
  and exists (
    select 1
    from public.import_batches batch
    where batch.id = import_batch_id
      and batch.tenant_id = tenant_id
      and batch.property_id = property_id
      and batch.status in ('inspecting','mapping_required')
  )
);

create policy import_activity_events_manager_select
on public.import_activity_events for select to authenticated
using ((select app_private.is_active_property_import_manager(property_id)));

revoke insert, update, delete on
  public.import_commits,
  public.import_commit_items
from authenticated;
revoke insert, update, delete on public.import_activity_events
from authenticated;
revoke update, delete on public.import_source_label_resolutions
from authenticated;
revoke update on
  public.import_source_rows,
  public.import_field_mappings,
  public.import_issues
from authenticated;
grant select on
  public.import_source_label_resolutions,
  public.import_activity_events
to authenticated;
grant insert on public.import_source_label_resolutions to authenticated;

create or replace function app_private.can_manage_property_import_object(
  p_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  parts text[];
  tenant_id uuid;
  property_id uuid;
  batch_id uuid;
begin
  parts := storage.foldername(p_name);
  if cardinality(parts) <> 4
    or parts[3] <> 'imports'
    or nullif(parts[4], '') is null then
    return false;
  end if;
  begin
    tenant_id := parts[1]::uuid;
    property_id := parts[2]::uuid;
    batch_id := parts[4]::uuid;
  exception
    when others then
      return false;
  end;
  return app_private.is_active_property_import_manager(property_id)
    and exists (
      select 1
      from public.import_batches batch
      where batch.id = batch_id
        and batch.tenant_id = tenant_id
        and batch.property_id = property_id
        and batch.storage_object_path = p_name
    );
end;
$$;

drop policy if exists import_files_manager_update on storage.objects;
drop policy if exists import_files_manager_delete on storage.objects;

revoke all on function
  app_private.is_active_property_import_manager(uuid),
  app_private.assert_active_property_import_manager(uuid),
  app_private.is_import_batch_transition_allowed(
    public.import_batch_status,
    public.import_batch_status
  ),
  app_private.enforce_import_batch_transition(),
  app_private.record_import_batch_transition(),
  app_private.bump_employee_identifier_version(),
  app_private.reject_import_evidence_mutation()
from public, anon, authenticated;
grant execute on function
  app_private.is_active_property_import_manager(uuid),
  app_private.is_import_batch_transition_allowed(
    public.import_batch_status,
    public.import_batch_status
  )
to authenticated;

create or replace function app_private.confirm_employee_import_field_mapping(
  p_batch_id uuid,
  p_expected_version bigint,
  p_mapping_decisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.import_batches%rowtype;
  decisions jsonb;
  decision jsonb;
  mapping_id uuid;
  decision_count integer;
begin
  select * into batch
  from public.import_batches
  where id = p_batch_id
  for update;
  if batch.id is null then
    raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'P3000';
  end if;
  perform app_private.assert_active_property_import_manager(batch.property_id);
  if batch.version <> p_expected_version then
    raise exception 'IMPORT_STALE_VERSION' using errcode = 'P3001';
  end if;
  if batch.status not in (
    'inspecting','mapping_required','validating','ready_for_review'
  ) then
    raise exception 'IMPORT_MAPPING_NOT_ALLOWED' using errcode = 'P3200';
  end if;

  decisions := case
    when jsonb_typeof(p_mapping_decisions) = 'array'
      then p_mapping_decisions
    when jsonb_typeof(p_mapping_decisions) = 'object'
      then jsonb_build_array(p_mapping_decisions)
    else null
  end;
  if decisions is null or jsonb_array_length(decisions) = 0 then
    raise exception 'IMPORT_MAPPING_DECISIONS_REQUIRED' using errcode = 'P3201';
  end if;
  select count(*)
  into decision_count
  from jsonb_array_elements(decisions) item;
  if decision_count <> (
    select count(distinct item->>'mappingId')
    from jsonb_array_elements(decisions) item
  ) then
    raise exception 'IMPORT_MAPPING_DECISION_DUPLICATE' using errcode = 'P3201';
  end if;

  for decision in
    select value from jsonb_array_elements(decisions)
  loop
    mapping_id := (decision->>'mappingId')::uuid;
    if coalesce(decision->>'mappingStatus', '') not in (
      'confirmed','excluded'
    ) then
      raise exception 'IMPORT_MAPPING_STATUS_INVALID' using errcode = 'P3201';
    end if;
    update public.import_field_mappings mapping
    set target_field = coalesce(
          nullif(btrim(decision->>'targetField'), ''),
          mapping.target_field
        ),
        transformation_rule = coalesce(
          decision->'transformationRule',
          mapping.transformation_rule
        ),
        mapping_status = (decision->>'mappingStatus')::public.import_mapping_status,
        approved_by = auth.uid(),
        approved_at = now(),
        updated_at = now()
    where mapping.id = mapping_id
      and mapping.import_batch_id = batch.id
      and mapping.tenant_id = batch.tenant_id
      and mapping.property_id = batch.property_id;
    if not found then
      raise exception 'IMPORT_MAPPING_NOT_FOUND' using errcode = 'P3202';
    end if;
  end loop;

  update public.import_batches
  set status = 'mapping_required',
      version = version + 1
  where id = batch.id
  returning * into batch;

  perform app_private.append_import_activity(
    batch,
    'field_mapping_confirmed',
    jsonb_build_object(
      'decisionCount', decision_count,
      'batchVersion', batch.version
    )
  );
  return jsonb_build_object(
    'batchId', batch.id,
    'version', batch.version,
    'status', batch.status
  );
exception
  when invalid_text_representation then
    raise exception 'IMPORT_MAPPING_ID_INVALID' using errcode = 'P3201';
end;
$$;

create or replace function public.confirm_employee_import_field_mapping(
  p_batch_id uuid,
  p_expected_version bigint,
  p_mapping_decisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  return app_private.confirm_employee_import_field_mapping(
    p_batch_id,
    p_expected_version,
    p_mapping_decisions
  );
end;
$$;

create or replace function app_private.resolve_employee_import_source_label(
  p_batch_id uuid,
  p_expected_version bigint,
  p_resolution_type text,
  p_source_label text,
  p_target_entity_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.import_batches%rowtype;
  normalized_label text;
  target_entity_type text;
  affected_rows integer;
  resolution_id uuid;
begin
  select * into batch
  from public.import_batches
  where id = p_batch_id
  for update;
  if batch.id is null then
    raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'P3000';
  end if;
  perform app_private.assert_active_property_import_manager(batch.property_id);
  if batch.version <> p_expected_version then
    raise exception 'IMPORT_STALE_VERSION' using errcode = 'P3001';
  end if;
  if p_resolution_type not in ('department','position')
    or p_decision not in ('mapped','excluded','deferred') then
    raise exception 'IMPORT_SOURCE_LABEL_DECISION_INVALID'
      using errcode = 'P3203';
  end if;
  normalized_label := app_private.normalize_source_label(p_source_label);
  if nullif(normalized_label, '') is null then
    raise exception 'IMPORT_SOURCE_LABEL_REQUIRED' using errcode = 'P3203';
  end if;

  if p_decision = 'mapped' then
    if p_target_entity_id is null then
      raise exception 'IMPORT_SOURCE_LABEL_TARGET_REQUIRED'
        using errcode = 'P3203';
    end if;
    if p_resolution_type = 'department' then
      if exists (
        select 1 from public.departments department
        where department.id = p_target_entity_id
          and department.tenant_id = batch.tenant_id
          and department.property_id = batch.property_id
          and department.is_active
      ) then
        target_entity_type := 'department';
      elsif exists (
        select 1 from public.operational_units unit
        where unit.id = p_target_entity_id
          and unit.tenant_id = batch.tenant_id
          and unit.property_id = batch.property_id
          and unit.is_active
      ) then
        target_entity_type := 'operational_unit';
      else
        raise exception 'IMPORT_SOURCE_LABEL_TARGET_SCOPE'
          using errcode = '23514';
      end if;
    elsif exists (
      select 1 from public.positions position
      where position.id = p_target_entity_id
        and position.tenant_id = batch.tenant_id
        and position.property_id = batch.property_id
        and position.is_active
    ) then
      target_entity_type := 'position';
    else
      raise exception 'IMPORT_SOURCE_LABEL_TARGET_SCOPE'
        using errcode = '23514';
    end if;
  elsif p_target_entity_id is not null then
    raise exception 'IMPORT_SOURCE_LABEL_TARGET_NOT_ALLOWED'
      using errcode = 'P3203';
  end if;

  select count(*)::integer into affected_rows
  from public.import_source_rows source_row
  where source_row.import_batch_id = batch.id
    and app_private.normalize_source_label(
      case p_resolution_type
        when 'department'
          then source_row.normalized_values->>'department_source_label'
        else source_row.normalized_values->>'position_source_label'
      end
    ) = normalized_label;
  if affected_rows = 0 then
    raise exception 'IMPORT_SOURCE_LABEL_NOT_FOUND' using errcode = 'P3203';
  end if;

  insert into public.import_source_label_resolutions(
    tenant_id,
    property_id,
    import_batch_id,
    resolution_type,
    source_label,
    normalized_source_label,
    affected_row_count,
    decision,
    target_entity_type,
    target_entity_id,
    approved_by,
    decided_at
  )
  values (
    batch.tenant_id,
    batch.property_id,
    batch.id,
    p_resolution_type,
    btrim(p_source_label),
    normalized_label,
    affected_rows,
    p_decision,
    target_entity_type,
    p_target_entity_id,
    auth.uid(),
    now()
  )
  on conflict (
    import_batch_id,
    resolution_type,
    normalized_source_label
  )
  do update set
    source_label = excluded.source_label,
    affected_row_count = excluded.affected_row_count,
    decision = excluded.decision,
    target_entity_type = excluded.target_entity_type,
    target_entity_id = excluded.target_entity_id,
    approved_by = auth.uid(),
    decided_at = now(),
    updated_at = now(),
    version = public.import_source_label_resolutions.version + 1
  returning id into resolution_id;

  update public.import_batches
  set status = 'mapping_required',
      version = version + 1
  where id = batch.id
  returning * into batch;

  perform app_private.append_import_activity(
    batch,
    'source_label_resolved',
    jsonb_build_object(
      'resolutionId', resolution_id,
      'resolutionType', p_resolution_type,
      'sourceLabel', btrim(p_source_label),
      'decision', p_decision,
      'targetEntityType', target_entity_type,
      'targetEntityId', p_target_entity_id,
      'affectedRows', affected_rows,
      'batchVersion', batch.version
    )
  );
  return jsonb_build_object(
    'resolutionId', resolution_id,
    'version', batch.version,
    'status', batch.status,
    'affectedRows', affected_rows
  );
end;
$$;

create or replace function public.resolve_employee_import_source_label(
  p_batch_id uuid,
  p_expected_version bigint,
  p_resolution_type text,
  p_source_label text,
  p_target_entity_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  return app_private.resolve_employee_import_source_label(
    p_batch_id,
    p_expected_version,
    p_resolution_type,
    p_source_label,
    p_target_entity_id,
    p_decision
  );
end;
$$;

create or replace function app_private.resolve_employee_import_issue(
  p_batch_id uuid,
  p_expected_version bigint,
  p_issue_id uuid,
  p_resolution text,
  p_resolution_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.import_batches%rowtype;
  issue public.import_issues%rowtype;
  corrections jsonb;
begin
  select * into batch
  from public.import_batches
  where id = p_batch_id
  for update;
  if batch.id is null then
    raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'P3000';
  end if;
  perform app_private.assert_active_property_import_manager(batch.property_id);
  if batch.version <> p_expected_version then
    raise exception 'IMPORT_STALE_VERSION' using errcode = 'P3001';
  end if;
  if p_resolution not in (
    'accepted','corrected','excluded','ignored','deferred'
  ) then
    raise exception 'IMPORT_ISSUE_RESOLUTION_INVALID' using errcode = 'P3210';
  end if;
  select * into issue
  from public.import_issues
  where id = p_issue_id
    and import_batch_id = batch.id
    and tenant_id = batch.tenant_id
    and property_id = batch.property_id
  for update;
  if issue.id is null then
    raise exception 'IMPORT_ISSUE_NOT_FOUND' using errcode = 'P3210';
  end if;

  corrections := coalesce(
    p_resolution_payload->'corrections',
    p_resolution_payload->'normalizedValues',
    '{}'::jsonb
  );
  if jsonb_typeof(corrections) <> 'object'
    or exists (
      select 1
      from jsonb_object_keys(corrections) field_name
      where field_name not in (
        'employee_number',
        'name_zh',
        'name_en',
        'department_source_label',
        'position_source_label',
        'department_id',
        'operational_unit_id',
        'position_id',
        'position_family_id',
        'grade_or_band',
        'hire_date',
        'probation_or_confirmation_date',
        'employment_status',
        'lms_employee_id',
        'merlin_id'
      )
    ) then
    raise exception 'IMPORT_ISSUE_CORRECTION_FIELDS_INVALID'
      using errcode = 'P3210';
  end if;
  if p_resolution = 'corrected' and corrections = '{}'::jsonb then
    raise exception 'IMPORT_ISSUE_CORRECTION_REQUIRED' using errcode = 'P3210';
  end if;

  if issue.import_source_row_id is not null
    and p_resolution = 'corrected' then
    update public.import_source_rows
    set normalized_values = normalized_values || corrections,
        processing_status = 'staged',
        proposed_action = 'unresolved',
        validation_summary = '{}'::jsonb,
        updated_at = now()
    where id = issue.import_source_row_id
      and import_batch_id = batch.id;
  elsif issue.import_source_row_id is not null
    and p_resolution = 'excluded' then
    update public.import_source_rows
    set processing_status = 'excluded',
        proposed_action = 'excluded',
        validation_summary = jsonb_build_object(
          'previewClassification',
          'excluded',
          'resolutionIssueId',
          issue.id
        ),
        updated_at = now()
    where id = issue.import_source_row_id
      and import_batch_id = batch.id;
  end if;

  update public.import_issues
  set resolution_status = p_resolution::public.import_resolution_status,
      suggested_resolution = coalesce(p_resolution_payload, '{}'::jsonb),
      resolved_by = auth.uid(),
      resolved_at = case when p_resolution = 'deferred' then null else now() end,
      updated_at = now()
  where id = issue.id;

  update public.import_batches
  set status = 'mapping_required',
      version = version + 1
  where id = batch.id
  returning * into batch;

  perform app_private.append_import_activity(
    batch,
    'issue_resolved',
    jsonb_build_object(
      'issueId', issue.id,
      'resolution', p_resolution,
      'correctedFields', (
        select coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
        from jsonb_object_keys(corrections) field_name
      ),
      'batchVersion', batch.version
    )
  );
  return jsonb_build_object(
    'issueId', issue.id,
    'resolution', p_resolution,
    'version', batch.version,
    'status', batch.status
  );
end;
$$;

create or replace function public.resolve_employee_import_issue(
  p_batch_id uuid,
  p_expected_version bigint,
  p_issue_id uuid,
  p_resolution text,
  p_resolution_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  return app_private.resolve_employee_import_issue(
    p_batch_id,
    p_expected_version,
    p_issue_id,
    p_resolution,
    p_resolution_payload
  );
end;
$$;

create or replace function app_private.prepare_employee_import_preview(
  p_batch_id uuid,
  p_expected_version bigint,
  p_options jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  batch public.import_batches%rowtype;
  source_row public.import_source_rows%rowtype;
  employee public.employees%rowtype;
  department_resolution public.import_source_label_resolutions%rowtype;
  position_resolution public.import_source_label_resolutions%rowtype;
  has_employee boolean;
  has_department_resolution boolean;
  has_position_resolution boolean;
  has_status_mapping boolean;
  selected_status_treatment text;
  values_to_commit jsonb;
  validation jsonb;
  error_codes jsonb;
  preview_classification text;
  row_proposed_action public.import_proposed_action;
  row_processing_status public.import_row_status;
  employee_number text;
  name_zh text;
  name_en text;
  department_id uuid;
  operational_unit_id uuid;
  position_id uuid;
  position_family_id uuid;
  grade_or_band text;
  hire_date date;
  probation_date date;
  employment_status public.employee_employment_status;
  employee_is_active boolean;
  is_new_employee boolean;
  new_employee_days integer;
  additions integer := 0;
  updates integer := 0;
  unchanged integer := 0;
  exclusions integer := 0;
  blocked integer := 0;
  unresolved integer := 0;
  total_rows integer := 0;
  next_version bigint;
  next_status public.import_batch_status;
  label text;
begin
  select * into batch
  from public.import_batches
  where id = p_batch_id
  for update;
  if batch.id is null then
    raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'P3000';
  end if;
  perform app_private.assert_active_property_import_manager(batch.property_id);
  if batch.version <> p_expected_version then
    raise exception 'IMPORT_STALE_VERSION' using errcode = 'P3001';
  end if;
  if batch.status not in (
    'inspecting','mapping_required','validating','ready_for_review'
  ) then
    raise exception 'IMPORT_PREVIEW_NOT_ALLOWED' using errcode = 'P3021';
  end if;
  if jsonb_typeof(coalesce(p_options, '{}'::jsonb)) <> 'object' then
    raise exception 'IMPORT_PREVIEW_OPTIONS_INVALID' using errcode = 'P3020';
  end if;

  select exists (
    select 1
    from public.import_field_mappings mapping
    where mapping.import_batch_id = batch.id
      and mapping.target_field = 'employment_status'
      and mapping.mapping_status = 'confirmed'
  ) into has_status_mapping;
  selected_status_treatment := nullif(
    btrim(p_options->>'statusTreatment'),
    ''
  );
  if has_status_mapping then
    selected_status_treatment := coalesce(
      selected_status_treatment,
      'use_recognized_status'
    );
    if selected_status_treatment not in (
      'use_recognized_status',
      'retain_existing_set_additions_active'
    ) then
      raise exception 'IMPORT_STATUS_TREATMENT_INVALID' using errcode = 'P3020';
    end if;
  elsif selected_status_treatment <> 'retain_existing_set_additions_active'
    or selected_status_treatment is null then
    raise exception 'IMPORT_STATUS_TREATMENT_REQUIRED' using errcode = 'P3020';
  end if;

  select settings.new_employee_days
  into new_employee_days
  from public.property_settings settings
  where settings.property_id = batch.property_id;
  if new_employee_days is null then
    raise exception 'IMPORT_PROPERTY_RULES_MISSING' using errcode = 'P3020';
  end if;

  if batch.status <> 'validating' then
    update public.import_batches
    set status = 'validating'
    where id = batch.id
    returning * into batch;
  end if;
  next_version := batch.version + 1;

  for source_row in
    select *
    from public.import_source_rows
    where import_batch_id = batch.id
    order by source_row_number, id
    for update
  loop
    total_rows := total_rows + 1;
    values_to_commit := source_row.normalized_values;
    error_codes := '[]'::jsonb;
    preview_classification := null;
    row_proposed_action := 'unresolved';
    row_processing_status := 'error';
    employee_number := nullif(btrim(values_to_commit->>'employee_number'), '');
    name_zh := nullif(btrim(values_to_commit->>'name_zh'), '');
    name_en := nullif(btrim(values_to_commit->>'name_en'), '');
    department_id := null;
    operational_unit_id := null;
    position_id := null;
    position_family_id := null;
    grade_or_band := nullif(btrim(values_to_commit->>'grade_or_band'), '');
    hire_date := null;
    probation_date := null;
    employment_status := null;
    employee_is_active := true;
    is_new_employee := false;
    has_employee := false;

    if source_row.processing_status = 'excluded'
      or source_row.proposed_action = 'excluded' then
      preview_classification := 'excluded';
    end if;

    if preview_classification is null
      and nullif(
        btrim(values_to_commit->>'department_source_label'),
        ''
      ) is not null then
      label := app_private.normalize_source_label(
        values_to_commit->>'department_source_label'
      );
      select * into department_resolution
      from public.import_source_label_resolutions resolution
      where resolution.import_batch_id = batch.id
        and resolution.resolution_type = 'department'
        and resolution.normalized_source_label = label;
      has_department_resolution := found;
      if not has_department_resolution
        or department_resolution.decision in ('pending','deferred') then
        preview_classification := 'unresolved';
        error_codes := error_codes || jsonb_build_array(
          'unresolved_department'
        );
      elsif department_resolution.decision = 'excluded' then
        preview_classification := 'excluded';
      elsif department_resolution.target_entity_type = 'department' then
        department_id := department_resolution.target_entity_id;
      elsif department_resolution.target_entity_type = 'operational_unit' then
        operational_unit_id := department_resolution.target_entity_id;
        select unit.department_id into department_id
        from public.operational_units unit
        where unit.id = operational_unit_id
          and unit.tenant_id = batch.tenant_id
          and unit.property_id = batch.property_id
          and unit.is_active;
        if department_id is null then
          preview_classification := 'blocked';
          error_codes := error_codes || jsonb_build_array(
            'invalid_operational_unit'
          );
        end if;
      end if;
    end if;

    if preview_classification is null and department_id is null then
      begin
        operational_unit_id := nullif(
          values_to_commit->>'operational_unit_id',
          ''
        )::uuid;
        department_id := nullif(
          values_to_commit->>'department_id',
          ''
        )::uuid;
      exception
        when invalid_text_representation then
          preview_classification := 'blocked';
          error_codes := error_codes || jsonb_build_array(
            'invalid_department_identifier'
          );
      end;
      if preview_classification is null and operational_unit_id is not null then
        select unit.department_id into department_id
        from public.operational_units unit
        where unit.id = operational_unit_id
          and unit.tenant_id = batch.tenant_id
          and unit.property_id = batch.property_id
          and unit.is_active
          and (
            department_id is null
            or unit.department_id = department_id
          );
        if department_id is null then
          preview_classification := 'blocked';
          error_codes := error_codes || jsonb_build_array(
            'invalid_operational_unit'
          );
        end if;
      end if;
    end if;

    if preview_classification is null
      and (
        department_id is null
        or not exists (
          select 1
          from public.departments department
          where department.id = department_id
            and department.tenant_id = batch.tenant_id
            and department.property_id = batch.property_id
            and department.is_active
        )
      ) then
      preview_classification := 'blocked';
      error_codes := error_codes || jsonb_build_array(
        'missing_or_invalid_department'
      );
    end if;

    if preview_classification is null
      and nullif(
        btrim(values_to_commit->>'position_source_label'),
        ''
      ) is not null then
      label := app_private.normalize_source_label(
        values_to_commit->>'position_source_label'
      );
      select * into position_resolution
      from public.import_source_label_resolutions resolution
      where resolution.import_batch_id = batch.id
        and resolution.resolution_type = 'position'
        and resolution.normalized_source_label = label;
      has_position_resolution := found;
      if not has_position_resolution
        or position_resolution.decision in ('pending','deferred') then
        preview_classification := 'unresolved';
        error_codes := error_codes || jsonb_build_array(
          'unresolved_position'
        );
      elsif position_resolution.decision = 'excluded' then
        preview_classification := 'excluded';
      else
        position_id := position_resolution.target_entity_id;
      end if;
    end if;

    if preview_classification is null and position_id is null then
      begin
        position_id := nullif(values_to_commit->>'position_id', '')::uuid;
      exception
        when invalid_text_representation then
          preview_classification := 'blocked';
          error_codes := error_codes || jsonb_build_array(
            'invalid_position_identifier'
          );
      end;
    end if;
    if preview_classification is null then
      select position.position_family_id into position_family_id
      from public.positions position
      where position.id = position_id
        and position.tenant_id = batch.tenant_id
        and position.property_id = batch.property_id
        and position.is_active;
      if position_id is null or not found then
        preview_classification := 'blocked';
        error_codes := error_codes || jsonb_build_array(
          'missing_or_invalid_position'
        );
      end if;
    end if;

    if preview_classification is null
      and (
        employee_number is null
        or (name_zh is null and name_en is null)
      ) then
      preview_classification := 'blocked';
      error_codes := error_codes || jsonb_build_array(
        case
          when employee_number is null then 'missing_employee_number'
          else 'missing_name'
        end
      );
    end if;

    if preview_classification is null
      and (
        select count(*)
        from public.import_source_rows duplicate_row
        where duplicate_row.import_batch_id = batch.id
          and duplicate_row.proposed_action <> 'excluded'
          and nullif(
            btrim(duplicate_row.normalized_values->>'employee_number'),
            ''
          ) = employee_number
      ) > 1 then
      preview_classification := 'blocked';
      error_codes := error_codes || jsonb_build_array(
        'duplicate_employee_number_in_file'
      );
    end if;

    if preview_classification is null then
      begin
        hire_date := nullif(values_to_commit->>'hire_date', '')::date;
        probation_date := nullif(
          values_to_commit->>'probation_or_confirmation_date',
          ''
        )::date;
      exception
        when invalid_datetime_format or datetime_field_overflow then
          preview_classification := 'blocked';
          error_codes := error_codes || jsonb_build_array('invalid_date');
      end;
      if preview_classification is null and hire_date is null then
        preview_classification := 'blocked';
        error_codes := error_codes || jsonb_build_array('missing_hire_date');
      end if;
    end if;

    if preview_classification is null then
      select * into employee
      from public.employees existing_employee
      where existing_employee.property_id = batch.property_id
        and existing_employee.employee_number = employee_number;
      has_employee := found;

      if has_status_mapping
        and nullif(
          btrim(values_to_commit->>'employment_status'),
          ''
        ) is not null then
        begin
          employment_status := (
            values_to_commit->>'employment_status'
          )::public.employee_employment_status;
        exception
          when invalid_text_representation then
            preview_classification := 'blocked';
            error_codes := error_codes || jsonb_build_array(
              'unsupported_status'
            );
        end;
        employee_is_active := employment_status not in (
          'inactive','terminated'
        );
      elsif has_employee then
        employment_status := employee.employment_status;
        employee_is_active := employee.is_active;
      else
        employment_status := 'active';
        employee_is_active := true;
      end if;
    end if;

    if preview_classification is null then
      is_new_employee := hire_date between
        current_date - (new_employee_days - 1)
        and current_date;
      if exists (
        select 1
        from public.employee_external_identifiers identifier
        where identifier.property_id = batch.property_id
          and identifier.source_system = batch.source_system
          and identifier.identifier_value in (
            employee_number,
            nullif(values_to_commit->>'lms_employee_id', ''),
            nullif(values_to_commit->>'merlin_id', '')
          )
          and (
            not has_employee
            or identifier.employee_id <> employee.id
          )
      ) then
        preview_classification := 'blocked';
        error_codes := error_codes || jsonb_build_array(
          'external_identifier_conflict'
        );
      end if;
    end if;

    if preview_classification is null then
      values_to_commit := values_to_commit || jsonb_build_object(
        'employee_number', employee_number,
        'name_zh', name_zh,
        'name_en', name_en,
        'department_id', department_id,
        'operational_unit_id', operational_unit_id,
        'position_id', position_id,
        'position_family_id', position_family_id,
        'grade_or_band', grade_or_band,
        'hire_date', hire_date,
        'probation_or_confirmation_date', probation_date,
        'employment_status', employment_status,
        'is_new_employee', is_new_employee,
        'is_active', employee_is_active
      );
      if not has_employee then
        preview_classification := 'addition';
      elsif employee.name_zh is not distinct from name_zh
        and employee.name_en is not distinct from name_en
        and employee.department_id is not distinct from department_id
        and employee.operational_unit_id is not distinct from operational_unit_id
        and employee.position_id is not distinct from position_id
        and employee.position_family_id is not distinct from position_family_id
        and employee.grade_or_band is not distinct from grade_or_band
        and employee.hire_date is not distinct from hire_date
        and employee.probation_or_confirmation_date
          is not distinct from probation_date
        and employee.employment_status is not distinct from employment_status
        and employee.is_new_employee is not distinct from is_new_employee
        and employee.is_active is not distinct from employee_is_active then
        preview_classification := 'unchanged';
      else
        preview_classification := 'update';
      end if;
    end if;

    case preview_classification
      when 'addition' then
        additions := additions + 1;
        row_proposed_action := 'insert';
        row_processing_status := 'valid';
      when 'update' then
        updates := updates + 1;
        row_proposed_action := 'update';
        row_processing_status := 'valid';
      when 'unchanged' then
        unchanged := unchanged + 1;
        row_proposed_action := 'unchanged';
        row_processing_status := 'valid';
      when 'excluded' then
        exclusions := exclusions + 1;
        row_proposed_action := 'excluded';
        row_processing_status := 'excluded';
      when 'blocked' then
        blocked := blocked + 1;
        row_proposed_action := 'unresolved';
        row_processing_status := 'error';
      else
        unresolved := unresolved + 1;
        row_proposed_action := 'unresolved';
        row_processing_status := 'error';
        preview_classification := 'unresolved';
    end case;

    validation := jsonb_build_object(
      'preview_classification', preview_classification,
      'preview_batch_version', next_version,
      'expected_employee_version',
        case when has_employee then employee.version else null end,
      'current_snapshot',
        case when has_employee then to_jsonb(employee) else null end,
      'errors', error_codes
    );
    update public.import_source_rows
    set normalized_values = values_to_commit,
        processing_status = row_processing_status,
        proposed_action = row_proposed_action,
        matched_employee_id = case when has_employee then employee.id else null end,
        validation_summary = validation,
        updated_at = now()
    where id = source_row.id;
  end loop;

  next_status := case
    when blocked + unresolved = 0 then 'ready_for_review'
    else 'mapping_required'
  end;
  update public.import_batches
  set status = next_status,
      total_source_rows = total_rows,
      valid_rows = additions + updates + unchanged,
      warning_rows = 0,
      error_rows = blocked + unresolved,
      excluded_rows = exclusions,
      status_treatment = selected_status_treatment,
      preview_summary = jsonb_build_object(
        'additions', additions,
        'updates', updates,
        'unchanged', unchanged,
        'exclusions', exclusions,
        'blocked', blocked,
        'unresolved', unresolved,
        'trainingHistoryImported', false,
        'ctcGtcImported', false
      ),
      previewed_by = auth.uid(),
      previewed_at = now(),
      version = next_version
  where id = batch.id
  returning * into batch;

  perform app_private.append_import_activity(
    batch,
    'preview_prepared',
    batch.preview_summary || jsonb_build_object(
      'statusTreatment', selected_status_treatment,
      'batchVersion', batch.version
    )
  );
  return batch.preview_summary || jsonb_build_object(
    'version', batch.version,
    'status', batch.status
  );
end;
$$;

create or replace function public.prepare_employee_import_preview(
  p_batch_id uuid,
  p_expected_version bigint,
  p_options jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  return app_private.prepare_employee_import_preview(
    p_batch_id,
    p_expected_version,
    p_options
  );
end;
$$;

create or replace function app_private.commit_employee_import(
  p_batch_id uuid,
  p_expected_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  batch public.import_batches%rowtype;
  source_row public.import_source_rows%rowtype;
  employee public.employees%rowtype;
  existing_commit public.import_commits%rowtype;
  commit_id uuid;
  employee_number text;
  expected_employee_version bigint;
  before_snapshot jsonb;
  after_snapshot jsonb;
  identifier_before_snapshots jsonb;
  identifier_after_snapshots jsonb;
  inserted_count integer := 0;
  updated_count integer := 0;
  unchanged_count integer := 0;
  excluded_count integer := 0;
  new_employee_days integer;
begin
  select * into batch
  from public.import_batches
  where id = p_batch_id
  for update;
  if batch.id is null then
    raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'P3000';
  end if;
  perform app_private.assert_active_property_import_manager(batch.property_id);

  select * into existing_commit
  from public.import_commits
  where import_batch_id = batch.id;
  if existing_commit.id is not null
    and batch.status in ('completed','completed_with_warnings') then
    return existing_commit.id;
  end if;
  if batch.version <> p_expected_version then
    raise exception 'IMPORT_STALE_VERSION' using errcode = 'P3001';
  end if;
  if batch.status <> 'ready_for_review' then
    raise exception 'IMPORT_NOT_READY' using errcode = 'P3002';
  end if;
  if batch.previewed_at is null
    or batch.previewed_by is null
    or coalesce((batch.preview_summary->>'blocked')::integer, 0) <> 0
    or coalesce((batch.preview_summary->>'unresolved')::integer, 0) <> 0 then
    raise exception 'IMPORT_UNRESOLVED_ROWS' using errcode = 'P3003';
  end if;
  if exists (
    select 1
    from public.import_source_rows unresolved_row
    where unresolved_row.import_batch_id = batch.id
      and unresolved_row.proposed_action = 'unresolved'
  ) or exists (
    select 1
    from public.import_issues issue
    where issue.import_batch_id = batch.id
      and issue.severity = 'error'
      and issue.resolution_status in ('unresolved','deferred')
  ) then
    raise exception 'IMPORT_UNRESOLVED_ROWS' using errcode = 'P3003';
  end if;
  if exists (
    select 1
    from public.import_source_rows duplicate_row
    where duplicate_row.import_batch_id = batch.id
      and duplicate_row.proposed_action <> 'excluded'
    group by nullif(
      btrim(duplicate_row.normalized_values->>'employee_number'),
      ''
    )
    having count(*) > 1
  ) then
    raise exception 'IMPORT_DUPLICATE_EMPLOYEE_NUMBER' using errcode = 'P3004';
  end if;
  if exists (
    select 1
    from public.import_source_rows preview_row
    where preview_row.import_batch_id = batch.id
      and preview_row.proposed_action <> 'excluded'
      and coalesce(
        (preview_row.validation_summary->>'preview_batch_version')::bigint,
        -1
      ) <> batch.version
  ) then
    raise exception 'IMPORT_STALE_VERSION' using errcode = 'P3001';
  end if;

  select settings.new_employee_days
  into new_employee_days
  from public.property_settings settings
  where settings.property_id = batch.property_id;
  if new_employee_days is null then
    raise exception 'IMPORT_PROPERTY_RULES_MISSING' using errcode = 'P3020';
  end if;

  perform 1
  from public.employees locked_employee
  where locked_employee.id in (
    select matched_employee_id
    from public.import_source_rows
    where import_batch_id = batch.id
      and matched_employee_id is not null
  )
  order by locked_employee.id
  for update;

  perform 1
  from public.employee_external_identifiers locked_identifier
  where locked_identifier.property_id = batch.property_id
    and (
      locked_identifier.employee_id in (
        select matched_employee_id
        from public.import_source_rows
        where import_batch_id = batch.id
          and matched_employee_id is not null
      )
      or locked_identifier.identifier_value in (
        select identifier_value
        from public.import_source_rows candidate
        cross join lateral (
          values
            (candidate.normalized_values->>'employee_number'),
            (candidate.normalized_values->>'lms_employee_id'),
            (candidate.normalized_values->>'merlin_id')
        ) identifier(identifier_value)
        where candidate.import_batch_id = batch.id
          and nullif(identifier_value, '') is not null
      )
    )
  order by locked_identifier.id
  for update;

  for source_row in
    select *
    from public.import_source_rows
    where import_batch_id = batch.id
    order by source_row_number, id
  loop
    employee_number := nullif(
      btrim(source_row.normalized_values->>'employee_number'),
      ''
    );
    if source_row.proposed_action in ('update','unchanged') then
      select * into employee
      from public.employees current_employee
      where current_employee.property_id = batch.property_id
        and current_employee.employee_number = employee_number;
      if not found
        or employee.id <> source_row.matched_employee_id then
        raise exception 'IMPORT_EMPLOYEE_STALE_VERSION'
          using errcode = 'P3005';
      end if;
      expected_employee_version := (
        source_row.validation_summary->>'expected_employee_version'
      )::bigint;
      if employee.version <> expected_employee_version then
        raise exception 'IMPORT_EMPLOYEE_STALE_VERSION'
          using errcode = 'P3005';
      end if;
    elsif source_row.proposed_action = 'insert'
      and exists (
        select 1
        from public.employees current_employee
        where current_employee.property_id = batch.property_id
          and current_employee.employee_number = employee_number
      ) then
      raise exception 'IMPORT_EMPLOYEE_STALE_VERSION'
        using errcode = 'P3005';
    end if;

    if source_row.proposed_action in ('insert','update')
      and exists (
        select 1
        from public.employee_external_identifiers identifier
        where identifier.property_id = batch.property_id
          and identifier.source_system = batch.source_system
          and identifier.identifier_value in (
            employee_number,
            nullif(source_row.normalized_values->>'lms_employee_id', ''),
            nullif(source_row.normalized_values->>'merlin_id', '')
          )
          and (
            source_row.proposed_action = 'insert'
            or identifier.employee_id <> source_row.matched_employee_id
          )
      ) then
      raise exception 'IMPORT_EXTERNAL_IDENTIFIER_CONFLICT'
        using errcode = 'P3006';
    end if;
  end loop;

  update public.import_batches
  set status = 'importing'
  where id = batch.id
  returning * into batch;

  insert into public.import_commits(
    tenant_id,
    property_id,
    import_batch_id,
    committed_by
  )
  values (
    batch.tenant_id,
    batch.property_id,
    batch.id,
    auth.uid()
  )
  returning id into commit_id;

  for source_row in
    select *
    from public.import_source_rows
    where import_batch_id = batch.id
    order by source_row_number, id
    for update
  loop
    employee_number := nullif(
      btrim(source_row.normalized_values->>'employee_number'),
      ''
    );
    before_snapshot := null;
    after_snapshot := null;
    identifier_before_snapshots := '[]'::jsonb;
    identifier_after_snapshots := '[]'::jsonb;

    if source_row.proposed_action = 'insert' then
      insert into public.employees(
        tenant_id,
        property_id,
        employee_number,
        name_zh,
        name_en,
        department_id,
        operational_unit_id,
        position_id,
        position_family_id,
        grade_or_band,
        hire_date,
        probation_or_confirmation_date,
        employment_status,
        is_new_employee,
        is_active,
        source_system,
        source_batch_id,
        created_by,
        updated_by
      )
      values (
        batch.tenant_id,
        batch.property_id,
        employee_number,
        nullif(source_row.normalized_values->>'name_zh', ''),
        nullif(source_row.normalized_values->>'name_en', ''),
        nullif(source_row.normalized_values->>'department_id', '')::uuid,
        nullif(
          source_row.normalized_values->>'operational_unit_id',
          ''
        )::uuid,
        nullif(source_row.normalized_values->>'position_id', '')::uuid,
        nullif(
          source_row.normalized_values->>'position_family_id',
          ''
        )::uuid,
        nullif(source_row.normalized_values->>'grade_or_band', ''),
        nullif(source_row.normalized_values->>'hire_date', '')::date,
        nullif(
          source_row.normalized_values->>'probation_or_confirmation_date',
          ''
        )::date,
        (
          source_row.normalized_values->>'employment_status'
        )::public.employee_employment_status,
        (
          nullif(source_row.normalized_values->>'hire_date', '')::date
          between current_date - (new_employee_days - 1) and current_date
        ),
        (source_row.normalized_values->>'is_active')::boolean,
        batch.source_system,
        batch.id,
        auth.uid(),
        auth.uid()
      )
      returning * into employee;
      after_snapshot := to_jsonb(employee);
      inserted_count := inserted_count + 1;
    elsif source_row.proposed_action = 'update' then
      select * into employee
      from public.employees current_employee
      where current_employee.id = source_row.matched_employee_id
      for update;
      before_snapshot := to_jsonb(employee);
      select coalesce(
        jsonb_agg(to_jsonb(identifier) order by identifier.id),
        '[]'::jsonb
      )
      into identifier_before_snapshots
      from public.employee_external_identifiers identifier
      where identifier.employee_id = employee.id
        and identifier.source_system = batch.source_system;

      update public.employees
      set name_zh = nullif(source_row.normalized_values->>'name_zh', ''),
          name_en = nullif(source_row.normalized_values->>'name_en', ''),
          department_id = nullif(
            source_row.normalized_values->>'department_id',
            ''
          )::uuid,
          operational_unit_id = nullif(
            source_row.normalized_values->>'operational_unit_id',
            ''
          )::uuid,
          position_id = nullif(
            source_row.normalized_values->>'position_id',
            ''
          )::uuid,
          position_family_id = nullif(
            source_row.normalized_values->>'position_family_id',
            ''
          )::uuid,
          grade_or_band = nullif(
            source_row.normalized_values->>'grade_or_band',
            ''
          ),
          hire_date = nullif(
            source_row.normalized_values->>'hire_date',
            ''
          )::date,
          probation_or_confirmation_date = nullif(
            source_row.normalized_values->>'probation_or_confirmation_date',
            ''
          )::date,
          employment_status = (
            source_row.normalized_values->>'employment_status'
          )::public.employee_employment_status,
          is_new_employee = (
            nullif(source_row.normalized_values->>'hire_date', '')::date
            between current_date - (new_employee_days - 1) and current_date
          ),
          is_active = (
            source_row.normalized_values->>'is_active'
          )::boolean,
          source_system = batch.source_system,
          source_batch_id = batch.id,
          updated_at = now(),
          updated_by = auth.uid(),
          version = version + 1
      where id = employee.id
      returning * into employee;
      after_snapshot := to_jsonb(employee);
      updated_count := updated_count + 1;
    elsif source_row.proposed_action = 'unchanged' then
      select * into employee
      from public.employees current_employee
      where current_employee.id = source_row.matched_employee_id;
      before_snapshot := to_jsonb(employee);
      after_snapshot := before_snapshot;
      unchanged_count := unchanged_count + 1;
    else
      excluded_count := excluded_count + 1;
    end if;

    if source_row.proposed_action in ('insert','update') then
      insert into public.employee_external_identifiers(
        tenant_id,
        property_id,
        employee_id,
        source_system,
        identifier_type,
        identifier_value,
        is_primary,
        is_active,
        source_batch_id
      )
      select
        batch.tenant_id,
        batch.property_id,
        employee.id,
        batch.source_system,
        identifier.identifier_type::public.employee_identifier_type,
        identifier.identifier_value,
        identifier.identifier_type = 'local_employee_number',
        true,
        batch.id
      from (
        values
          ('local_employee_number', employee_number),
          (
            'lms_employee_id',
            nullif(source_row.normalized_values->>'lms_employee_id', '')
          ),
          (
            'merlin_id',
            nullif(source_row.normalized_values->>'merlin_id', '')
          )
      ) identifier(identifier_type, identifier_value)
      where identifier.identifier_value is not null
      on conflict(property_id, source_system, identifier_value)
      do update set
        is_primary = excluded.is_primary,
        is_active = true,
        source_batch_id = batch.id
      where public.employee_external_identifiers.employee_id
        = excluded.employee_id;

      select coalesce(
        jsonb_agg(to_jsonb(identifier) order by identifier.id),
        '[]'::jsonb
      )
      into identifier_after_snapshots
      from public.employee_external_identifiers identifier
      where identifier.employee_id = employee.id
        and identifier.source_system = batch.source_system;
    end if;

    insert into public.import_commit_items(
      tenant_id,
      property_id,
      import_commit_id,
      import_source_row_id,
      employee_id,
      action,
      before_snapshot,
      after_snapshot,
      identifier_before_snapshots,
      identifier_after_snapshots
    )
    values (
      batch.tenant_id,
      batch.property_id,
      commit_id,
      source_row.id,
      case
        when source_row.proposed_action = 'excluded' then null
        else employee.id
      end,
      case source_row.proposed_action
        when 'insert' then 'insert'::public.import_commit_action
        when 'update' then 'update'::public.import_commit_action
        when 'unchanged' then 'unchanged'::public.import_commit_action
        else 'excluded'::public.import_commit_action
      end,
      before_snapshot,
      after_snapshot,
      identifier_before_snapshots,
      identifier_after_snapshots
    );

    update public.import_source_rows
    set processing_status = case
          when source_row.proposed_action = 'excluded'
            then 'excluded'::public.import_row_status
          else 'committed'::public.import_row_status
        end,
        updated_at = now()
    where id = source_row.id;
  end loop;

  update public.import_commits
  set inserted_employee_count = inserted_count,
      updated_employee_count = updated_count,
      unchanged_employee_count = unchanged_count,
      excluded_row_count = excluded_count,
      unresolved_row_count = 0,
      commit_summary = jsonb_build_object(
        'additions', inserted_count,
        'updates', updated_count,
        'unchanged', unchanged_count,
        'exclusions', excluded_count,
        'unresolved', 0,
        'training_history_imported', false,
        'ctc_gtc_imported', false
      )
  where id = commit_id;

  update public.import_batches
  set status = case
        when warning_rows > 0
          then 'completed_with_warnings'::public.import_batch_status
        else 'completed'::public.import_batch_status
      end,
      completed_at = now(),
      version = version + 1
  where id = batch.id;
  return commit_id;
end;
$$;

create or replace function public.commit_employee_import(
  p_batch_id uuid,
  p_expected_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  return app_private.commit_employee_import(
    p_batch_id,
    p_expected_version
  );
end;
$$;

create or replace function app_private.import_revert_conflict_count(
  p_batch_id uuid
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with commit_record as (
    select commit.id
    from public.import_commits commit
    where commit.import_batch_id = p_batch_id
  ),
  employee_conflicts as (
    select item.id
    from public.import_commit_items item
    join commit_record on commit_record.id = item.import_commit_id
    left join public.employees employee on employee.id = item.employee_id
    where item.action in ('insert','update')
      and (
        employee.id is null
        or employee.version <> coalesce(
          (item.after_snapshot->>'version')::bigint,
          -1
        )
        or employee.source_batch_id is distinct from p_batch_id
      )
  ),
  expected_identifiers as (
    select
      item.id item_id,
      snapshot.value snapshot
    from public.import_commit_items item
    join commit_record on commit_record.id = item.import_commit_id
    cross join lateral jsonb_array_elements(
      item.identifier_after_snapshots
    ) snapshot(value)
  ),
  identifier_conflicts as (
    select expected.item_id, expected.snapshot->>'id' identifier_id
    from expected_identifiers expected
    left join public.employee_external_identifiers identifier
      on identifier.id = (expected.snapshot->>'id')::uuid
    where identifier.id is null
      or identifier.version <> coalesce(
        (expected.snapshot->>'version')::bigint,
        -1
      )
      or identifier.is_active is distinct from coalesce(
        (expected.snapshot->>'is_active')::boolean,
        false
      )
      or identifier.source_batch_id is distinct from nullif(
        expected.snapshot->>'source_batch_id',
        ''
      )::uuid
  ),
  unexpected_identifiers as (
    select identifier.id
    from public.employee_external_identifiers identifier
    where identifier.source_batch_id = p_batch_id
      and not exists (
        select 1
        from expected_identifiers expected
        where expected.snapshot->>'id' = identifier.id::text
      )
  )
  select
    (select count(*) from employee_conflicts)
    + (select count(*) from identifier_conflicts)
    + (select count(*) from unexpected_identifiers);
$$;

create or replace function app_private.preview_employee_import_revert(
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  batch public.import_batches%rowtype;
  commit_record public.import_commits%rowtype;
  conflicts bigint;
  token text;
  expires_at timestamptz;
  preview_snapshot jsonb;
begin
  select * into batch
  from public.import_batches
  where id = p_batch_id;
  if batch.id is null then
    raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'P3000';
  end if;
  perform app_private.assert_active_property_import_manager(batch.property_id);
  select * into commit_record
  from public.import_commits commit
  where commit.import_batch_id = batch.id
  for update;
  if commit_record.id is null
    or commit_record.reverted_at is not null
    or batch.status not in ('completed','completed_with_warnings') then
    raise exception 'IMPORT_REVERT_NOT_ALLOWED' using errcode = 'P3010';
  end if;

  conflicts := app_private.import_revert_conflict_count(batch.id);
  if conflicts = 0 then
    token := encode(extensions.gen_random_bytes(32), 'hex');
    expires_at := now() + interval '5 minutes';
    preview_snapshot := jsonb_build_object(
      'batchVersion', batch.version,
      'employeeVersions', coalesce((
        select jsonb_object_agg(
          item.employee_id::text,
          (item.after_snapshot->>'version')::bigint
        )
        from public.import_commit_items item
        where item.import_commit_id = commit_record.id
          and item.action in ('insert','update')
      ), '{}'::jsonb),
      'identifierVersions', coalesce((
        select jsonb_object_agg(
          snapshot.value->>'id',
          (snapshot.value->>'version')::bigint
        )
        from public.import_commit_items item
        cross join lateral jsonb_array_elements(
          item.identifier_after_snapshots
        ) snapshot(value)
        where item.import_commit_id = commit_record.id
      ), '{}'::jsonb)
    );
    update public.import_commits
    set revert_preview_token_hash = encode(
          extensions.digest(token, 'sha256'),
          'hex'
        ),
        revert_preview_expires_at = expires_at,
        revert_preview_batch_version = batch.version,
        revert_preview_snapshot = preview_snapshot
    where id = commit_record.id;
  end if;

  return jsonb_build_object(
    'safe', conflicts = 0,
    'conflicts', conflicts,
    'token', token,
    'expiresAt', expires_at,
    'strategy',
      'inserted employees deactivate; updates restore audited snapshots'
  );
end;
$$;

create or replace function public.preview_employee_import_revert(
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  return app_private.preview_employee_import_revert(p_batch_id);
end;
$$;

drop function public.revert_employee_import(uuid);
drop function app_private.revert_employee_import(uuid);

create or replace function app_private.revert_employee_import(
  p_batch_id uuid,
  p_preview_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  batch public.import_batches%rowtype;
  commit_record public.import_commits%rowtype;
  item public.import_commit_items%rowtype;
  after_identifier jsonb;
  before_identifier jsonb;
  had_before_identifier boolean;
begin
  select * into batch
  from public.import_batches
  where id = p_batch_id
  for update;
  if batch.id is null then
    raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'P3000';
  end if;
  perform app_private.assert_active_property_import_manager(batch.property_id);
  select * into commit_record
  from public.import_commits commit
  where commit.import_batch_id = batch.id
  for update;
  if commit_record.id is null
    or commit_record.reverted_at is not null
    or batch.status not in ('completed','completed_with_warnings') then
    raise exception 'IMPORT_REVERT_NOT_ALLOWED' using errcode = 'P3010';
  end if;
  if nullif(p_preview_token, '') is null
    or commit_record.revert_preview_token_hash is null
    or encode(
      extensions.digest(p_preview_token, 'sha256'),
      'hex'
    ) <> commit_record.revert_preview_token_hash
    or commit_record.revert_preview_batch_version <> batch.version then
    raise exception 'IMPORT_REVERT_TOKEN_INVALID' using errcode = 'P3012';
  end if;
  if commit_record.revert_preview_expires_at <= now() then
    raise exception 'IMPORT_REVERT_TOKEN_EXPIRED' using errcode = 'P3012';
  end if;

  perform 1
  from public.employees employee
  where employee.id in (
    select commit_item.employee_id
    from public.import_commit_items commit_item
    where commit_item.import_commit_id = commit_record.id
      and commit_item.employee_id is not null
  )
  order by employee.id
  for update;
  perform 1
  from public.employee_external_identifiers identifier
  where identifier.id in (
    select (snapshot.value->>'id')::uuid
    from public.import_commit_items commit_item
    cross join lateral jsonb_array_elements(
      commit_item.identifier_after_snapshots
    ) snapshot(value)
    where commit_item.import_commit_id = commit_record.id
  )
  order by identifier.id
  for update;

  if app_private.import_revert_conflict_count(batch.id) <> 0 then
    raise exception 'IMPORT_REVERT_CONFLICT: later changes must be resolved first'
      using errcode = 'P3011';
  end if;

  for item in
    select *
    from public.import_commit_items
    where import_commit_id = commit_record.id
    order by created_at desc, id desc
  loop
    for after_identifier in
      select value
      from jsonb_array_elements(item.identifier_after_snapshots)
    loop
      select value into before_identifier
      from jsonb_array_elements(item.identifier_before_snapshots)
      where value->>'id' = after_identifier->>'id';
      had_before_identifier := found;
      if had_before_identifier then
        update public.employee_external_identifiers
        set is_primary = coalesce(
              (before_identifier->>'is_primary')::boolean,
              false
            ),
            is_active = coalesce(
              (before_identifier->>'is_active')::boolean,
              false
            ),
            source_batch_id = nullif(
              before_identifier->>'source_batch_id',
              ''
            )::uuid
        where id = (after_identifier->>'id')::uuid;
      else
        update public.employee_external_identifiers
        set is_active = false
        where id = (after_identifier->>'id')::uuid;
      end if;
    end loop;

    if item.action = 'insert' and item.employee_id is not null then
      update public.employees
      set employment_status = 'inactive',
          is_new_employee = false,
          is_active = false,
          updated_at = now(),
          updated_by = auth.uid(),
          version = version + 1
      where id = item.employee_id;
    elsif item.action = 'update' and item.employee_id is not null then
      update public.employees
      set name_zh = nullif(item.before_snapshot->>'name_zh', ''),
          name_en = nullif(item.before_snapshot->>'name_en', ''),
          department_id = nullif(
            item.before_snapshot->>'department_id',
            ''
          )::uuid,
          operational_unit_id = nullif(
            item.before_snapshot->>'operational_unit_id',
            ''
          )::uuid,
          position_id = nullif(
            item.before_snapshot->>'position_id',
            ''
          )::uuid,
          position_family_id = nullif(
            item.before_snapshot->>'position_family_id',
            ''
          )::uuid,
          grade_or_band = nullif(
            item.before_snapshot->>'grade_or_band',
            ''
          ),
          hire_date = nullif(
            item.before_snapshot->>'hire_date',
            ''
          )::date,
          probation_or_confirmation_date = nullif(
            item.before_snapshot->>'probation_or_confirmation_date',
            ''
          )::date,
          employment_status = (
            item.before_snapshot->>'employment_status'
          )::public.employee_employment_status,
          is_new_employee = (
            item.before_snapshot->>'is_new_employee'
          )::boolean,
          is_active = (item.before_snapshot->>'is_active')::boolean,
          source_system = item.before_snapshot->>'source_system',
          source_batch_id = nullif(
            item.before_snapshot->>'source_batch_id',
            ''
          )::uuid,
          updated_at = now(),
          updated_by = auth.uid(),
          version = version + 1
      where id = item.employee_id;
    end if;
  end loop;

  update public.import_commits
  set reverted_at = now(),
      reverted_by = auth.uid(),
      revert_preview_token_hash = null,
      revert_preview_expires_at = null,
      revert_preview_batch_version = null,
      revert_preview_snapshot = null
  where id = commit_record.id;
  update public.import_batches
  set status = 'reverted',
      reverted_at = now(),
      version = version + 1
  where id = batch.id;
end;
$$;

create or replace function public.revert_employee_import(
  p_batch_id uuid,
  p_preview_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  perform app_private.revert_employee_import(
    p_batch_id,
    p_preview_token
  );
end;
$$;

create or replace function public.list_department_employee_directory(
  p_search text,
  p_limit integer,
  p_offset integer
)
returns table (
  employee_number text,
  name_zh text,
  name_en text,
  department_id uuid,
  department_name_zh text,
  department_name_en text,
  operational_unit_id uuid,
  operational_unit_name_zh text,
  operational_unit_name_en text,
  position_id uuid,
  position_name_zh text,
  position_name_en text,
  position_family_id uuid,
  position_family_name_zh text,
  position_family_name_en text,
  hire_date date,
  probation_or_confirmation_date date,
  employment_status public.employee_employment_status,
  is_new_employee boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.user_accounts account
    join public.profiles profile
      on profile.id = account.user_id
     and profile.is_active
    join public.tenant_memberships tenant_membership
      on tenant_membership.tenant_id = account.tenant_id
     and tenant_membership.user_id = account.user_id
     and tenant_membership.status = 'active'
    join public.property_memberships property_membership
      on property_membership.tenant_id = account.tenant_id
     and property_membership.property_id = account.property_id
     and property_membership.user_id = account.user_id
     and property_membership.status = 'active'
    join public.role_assignments assignment
      on assignment.user_id = account.user_id
     and assignment.tenant_id = account.tenant_id
     and assignment.property_id = account.property_id
     and assignment.status = 'active'
    join public.roles role
      on role.id = assignment.role_id
     and role.code = 'department_training_admin'
     and role.scope_level = 'department'
     and role.is_active
    join public.trainer_scopes scope
      on scope.role_assignment_id = assignment.id
     and scope.tenant_id = assignment.tenant_id
     and scope.property_id = assignment.property_id
     and scope.is_active
    where account.auth_user_id = auth.uid()
      and account.account_status = 'active'
      and (account.locked_until is null or account.locked_until <= now())
  ) then
    raise exception 'DEPARTMENT_DIRECTORY_FORBIDDEN' using errcode = '42501';
  end if;

  return query
  with authorized_scopes as (
    select
      account.tenant_id,
      account.property_id,
      scope.department_id,
      scope.include_descendants
    from public.user_accounts account
    join public.profiles profile
      on profile.id = account.user_id
     and profile.is_active
    join public.tenant_memberships tenant_membership
      on tenant_membership.tenant_id = account.tenant_id
     and tenant_membership.user_id = account.user_id
     and tenant_membership.status = 'active'
    join public.property_memberships property_membership
      on property_membership.tenant_id = account.tenant_id
     and property_membership.property_id = account.property_id
     and property_membership.user_id = account.user_id
     and property_membership.status = 'active'
    join public.role_assignments assignment
      on assignment.user_id = account.user_id
     and assignment.tenant_id = account.tenant_id
     and assignment.property_id = account.property_id
     and assignment.status = 'active'
    join public.roles role
      on role.id = assignment.role_id
     and role.code = 'department_training_admin'
     and role.scope_level = 'department'
     and role.is_active
    join public.trainer_scopes scope
      on scope.role_assignment_id = assignment.id
     and scope.tenant_id = assignment.tenant_id
     and scope.property_id = assignment.property_id
     and scope.is_active
    where account.auth_user_id = auth.uid()
      and account.account_status = 'active'
      and (account.locked_until is null or account.locked_until <= now())
  ),
  authorized_departments as (
    select
      scope.tenant_id,
      scope.property_id,
      scope.department_id
    from authorized_scopes scope
    union
    select
      closure.tenant_id,
      closure.property_id,
      closure.descendant_department_id
    from authorized_scopes scope
    join public.department_closure closure
      on closure.tenant_id = scope.tenant_id
     and closure.property_id = scope.property_id
     and closure.ancestor_department_id = scope.department_id
    where scope.include_descendants
  ),
  filtered as (
    select distinct
      employee.id,
      employee.employee_number,
      employee.name_zh,
      employee.name_en,
      employee.department_id,
      department.name_zh department_name_zh,
      department.name_en department_name_en,
      employee.operational_unit_id,
      unit.name_zh operational_unit_name_zh,
      unit.name_en operational_unit_name_en,
      employee.position_id,
      position.name_zh position_name_zh,
      position.name_en position_name_en,
      employee.position_family_id,
      family.name_zh position_family_name_zh,
      family.name_en position_family_name_en,
      employee.hire_date,
      employee.probation_or_confirmation_date,
      employee.employment_status,
      employee.is_new_employee
    from public.employees employee
    join authorized_departments authorized
      on authorized.tenant_id = employee.tenant_id
     and authorized.property_id = employee.property_id
     and authorized.department_id = employee.department_id
    join public.departments department
      on department.id = employee.department_id
     and department.tenant_id = employee.tenant_id
     and department.property_id = employee.property_id
    left join public.operational_units unit
      on unit.id = employee.operational_unit_id
     and unit.tenant_id = employee.tenant_id
     and unit.property_id = employee.property_id
    left join public.positions position
      on position.id = employee.position_id
     and position.tenant_id = employee.tenant_id
     and position.property_id = employee.property_id
    left join public.position_families family
      on family.id = employee.position_family_id
     and family.tenant_id = employee.tenant_id
     and family.property_id = employee.property_id
    where nullif(btrim(coalesce(p_search, '')), '') is null
      or employee.employee_number ilike
        '%' || btrim(coalesce(p_search, '')) || '%'
      or coalesce(employee.name_zh, '') ilike
        '%' || btrim(coalesce(p_search, '')) || '%'
      or coalesce(employee.name_en, '') ilike
        '%' || btrim(coalesce(p_search, '')) || '%'
  )
  select
    filtered.employee_number,
    filtered.name_zh,
    filtered.name_en,
    filtered.department_id,
    filtered.department_name_zh,
    filtered.department_name_en,
    filtered.operational_unit_id,
    filtered.operational_unit_name_zh,
    filtered.operational_unit_name_en,
    filtered.position_id,
    filtered.position_name_zh,
    filtered.position_name_en,
    filtered.position_family_id,
    filtered.position_family_name_zh,
    filtered.position_family_name_en,
    filtered.hire_date,
    filtered.probation_or_confirmation_date,
    filtered.employment_status,
    filtered.is_new_employee,
    count(*) over() total_count
  from filtered
  order by filtered.employee_number
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function
  app_private.confirm_employee_import_field_mapping(uuid,bigint,jsonb),
  app_private.resolve_employee_import_source_label(
    uuid,bigint,text,text,uuid,text
  ),
  app_private.resolve_employee_import_issue(uuid,bigint,uuid,text,jsonb),
  app_private.prepare_employee_import_preview(uuid,bigint,jsonb),
  app_private.commit_employee_import(uuid,bigint),
  app_private.import_revert_conflict_count(uuid),
  app_private.preview_employee_import_revert(uuid),
  app_private.revert_employee_import(uuid,text),
  app_private.append_import_activity(
    public.import_batches,
    text,
    jsonb,
    public.import_batch_status,
    public.import_batch_status
  )
from public, anon, authenticated;

revoke all on function
  public.confirm_employee_import_field_mapping(uuid,bigint,jsonb),
  public.resolve_employee_import_source_label(
    uuid,bigint,text,text,uuid,text
  ),
  public.resolve_employee_import_issue(uuid,bigint,uuid,text,jsonb),
  public.prepare_employee_import_preview(uuid,bigint,jsonb),
  public.commit_employee_import(uuid,bigint),
  public.preview_employee_import_revert(uuid),
  public.revert_employee_import(uuid,text),
  public.list_department_employee_directory(text,integer,integer)
from public, anon, authenticated;

grant execute on function
  public.confirm_employee_import_field_mapping(uuid,bigint,jsonb),
  public.resolve_employee_import_source_label(
    uuid,bigint,text,text,uuid,text
  ),
  public.resolve_employee_import_issue(uuid,bigint,uuid,text,jsonb),
  public.prepare_employee_import_preview(uuid,bigint,jsonb),
  public.commit_employee_import(uuid,bigint),
  public.preview_employee_import_revert(uuid),
  public.revert_employee_import(uuid,text),
  public.list_department_employee_directory(text,integer,integer)
to authenticated;
