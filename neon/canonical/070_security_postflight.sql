begin;
set local role hotel_ld_migration_owner;

alter table public.tenants enable row level security;
alter table public.tenants force row level security;
alter table public.properties enable row level security;
alter table public.properties force row level security;
alter table public.property_domains enable row level security;
alter table public.property_domains force row level security;
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.user_accounts enable row level security;
alter table public.user_accounts force row level security;
alter table public.tenant_memberships enable row level security;
alter table public.tenant_memberships force row level security;
alter table public.property_memberships enable row level security;
alter table public.property_memberships force row level security;
alter table public.roles enable row level security;
alter table public.roles force row level security;
alter table public.role_assignments enable row level security;
alter table public.role_assignments force row level security;
alter table public.trainer_scopes enable row level security;
alter table public.trainer_scopes force row level security;
alter table public.departments enable row level security;
alter table public.departments force row level security;
alter table public.department_closure enable row level security;
alter table public.department_closure force row level security;
alter table public.department_aliases enable row level security;
alter table public.department_aliases force row level security;
alter table public.operational_units enable row level security;
alter table public.operational_units force row level security;
alter table public.operational_unit_aliases enable row level security;
alter table public.operational_unit_aliases force row level security;
alter table public.position_families enable row level security;
alter table public.position_families force row level security;
alter table public.positions enable row level security;
alter table public.positions force row level security;
alter table public.position_department_assignments enable row level security;
alter table public.position_department_assignments force row level security;
alter table public.position_aliases enable row level security;
alter table public.position_aliases force row level security;
alter table public.employees enable row level security;
alter table public.employees force row level security;
alter table public.employee_external_identifiers enable row level security;
alter table public.employee_external_identifiers force row level security;

alter table app_private.people_read_audit_events enable row level security;
alter table app_private.people_read_audit_events force row level security;
alter table app_private.organization_read_audit_events enable row level security;
alter table app_private.organization_read_audit_events force row level security;
alter table app_private.organization_write_audit_events enable row level security;
alter table app_private.organization_write_audit_events force row level security;
alter table app_private.organization_alias_resolution_audit_events enable row level security;
alter table app_private.organization_alias_resolution_audit_events force row level security;
alter table app_private.organization_operational_unit_audit_events enable row level security;
alter table app_private.organization_operational_unit_audit_events force row level security;
alter table app_private.organization_alias_activation_audit_events enable row level security;
alter table app_private.organization_alias_activation_audit_events force row level security;
alter table app_private.position_read_audit_events enable row level security;
alter table app_private.position_read_audit_events force row level security;
alter table app_private.position_write_audit_events enable row level security;
alter table app_private.position_write_audit_events force row level security;
alter table app_private.position_mapping_audit_events enable row level security;
alter table app_private.position_mapping_audit_events force row level security;
alter table app_private.employee_write_audit_events enable row level security;
alter table app_private.employee_write_audit_events force row level security;

create policy canonical_tenant_scope on public.tenants for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application') with check (session_user='hotel_ld_application');
create policy canonical_tenant_scope on public.properties for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and (app_private.actor_uuid_setting_or_null('app.actor_property_id') is null or id=app_private.actor_uuid_setting_or_null('app.actor_property_id')))
  with check (session_user='hotel_ld_application' and id=app_private.current_actor_property_id());
create policy canonical_tenant_scope on public.property_domains for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and (app_private.actor_uuid_setting_or_null('app.actor_property_id') is null or property_id=app_private.actor_uuid_setting_or_null('app.actor_property_id')))
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_actor_context_scope on public.profiles for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application') with check (session_user='hotel_ld_application');
create policy canonical_tenant_scope on public.user_accounts for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id())
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_tenant_scope on public.tenant_memberships for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application') with check (session_user='hotel_ld_application');
create policy canonical_tenant_scope on public.property_memberships for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id())
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_tenant_scope on public.roles for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and (property_id is null or property_id=app_private.current_actor_property_id()))
  with check (session_user='hotel_ld_application' and (property_id is null or property_id=app_private.current_actor_property_id()));
create policy canonical_tenant_scope on public.role_assignments for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id())
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_tenant_scope on public.trainer_scopes for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id())
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());

create policy canonical_departments_scope on public.departments for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id())
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_departments_scope on public.department_closure for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id())
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_departments_scope on public.department_aliases for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id())
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_operational_units_scope on public.operational_units for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id())
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_operational_units_scope on public.operational_unit_aliases for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id())
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_position_families_scope on public.position_families for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id())
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_positions_scope on public.positions for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id())
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_position_assignments_scope on public.position_department_assignments for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id())
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_positions_scope on public.position_aliases for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id())
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_employees_scope on public.employees for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id())
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_employee_identifiers_scope on public.employee_external_identifiers for all to hotel_ld_migration_owner
  using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id())
  with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());

create policy canonical_audit_insert on app_private.people_read_audit_events for insert to hotel_ld_migration_owner with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_audit_insert on app_private.organization_read_audit_events for insert to hotel_ld_migration_owner with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_audit_insert on app_private.organization_write_audit_events for insert to hotel_ld_migration_owner with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_audit_insert on app_private.organization_alias_resolution_audit_events for insert to hotel_ld_migration_owner with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_audit_insert on app_private.organization_operational_unit_audit_events for insert to hotel_ld_migration_owner with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_audit_insert on app_private.organization_alias_activation_audit_events for insert to hotel_ld_migration_owner with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_audit_insert on app_private.position_read_audit_events for insert to hotel_ld_migration_owner with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_audit_insert on app_private.position_write_audit_events for insert to hotel_ld_migration_owner with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_audit_insert on app_private.position_mapping_audit_events for insert to hotel_ld_migration_owner with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create policy canonical_audit_insert on app_private.employee_write_audit_events for insert to hotel_ld_migration_owner with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());

revoke all on all tables in schema public from public,hotel_ld_application;
revoke all on all sequences in schema public from public,hotel_ld_application;
revoke all on all tables in schema app_private from public,hotel_ld_application;
revoke all on all sequences in schema app_private from public,hotel_ld_application;
revoke all on schema app_private from public,hotel_ld_application;
revoke create on schema public from public,hotel_ld_application;

commit;
