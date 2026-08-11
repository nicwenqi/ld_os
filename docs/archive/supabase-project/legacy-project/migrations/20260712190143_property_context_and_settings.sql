create type public.domain_verification_status as enum ('pending', 'verified', 'failed');
create type public.probation_field_meaning as enum ('probation_end_date', 'confirmation_date', 'unused');
create type public.employee_status_source as enum ('excel_import', 'manual', 'future_hris');
create type public.property_initialization_state as enum ('not_started', 'in_progress', 'ready');

alter table public.properties
  add column brand text,
  add column city text,
  add column country_region text not null default 'CN',
  add column timezone text not null default 'Asia/Shanghai',
  add column default_language text not null default 'zh-CN';

alter table public.properties
  add constraint properties_country_region_not_blank check (btrim(country_region) <> ''),
  add constraint properties_timezone_not_blank check (btrim(timezone) <> ''),
  add constraint properties_default_language_not_blank check (btrim(default_language) <> '');

create table public.property_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  hostname text not null,
  subdomain text,
  is_primary boolean not null default false,
  verification_status public.domain_verification_status not null default 'pending',
  is_active boolean not null default true,
  verified_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_domains_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint property_domains_hostname_format_check
    check (hostname = lower(hostname) and hostname ~ '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  constraint property_domains_verification_check
    check (verification_status <> 'verified' or verified_at is not null),
  constraint property_domains_id_tenant_property_key unique (id, tenant_id, property_id)
);
create unique index property_domains_hostname_lower_uidx on public.property_domains (lower(hostname));
create unique index property_domains_primary_property_uidx on public.property_domains (property_id) where is_primary;
create index property_domains_property_active_idx on public.property_domains (property_id, is_active);
create index property_domains_tenant_idx on public.property_domains (tenant_id);

create table public.property_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  new_employee_days smallint not null default 90,
  probation_field_meaning public.probation_field_meaning not null default 'confirmation_date',
  employee_status_source public.employee_status_source not null default 'manual',
  ctc_mandatory boolean not null default true,
  gtc_mandatory boolean not null default true,
  initialization_state public.property_initialization_state not null default 'not_started',
  initialization_completed_at timestamptz,
  initialization_completed_by uuid references auth.users(id) on delete set null,
  version bigint not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_settings_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint property_settings_property_key unique (property_id),
  constraint property_settings_days_check check (new_employee_days between 1 and 365),
  constraint property_settings_version_check check (version > 0),
  constraint property_settings_initialization_check check (
    initialization_state <> 'ready' or
    (initialization_completed_at is not null and initialization_completed_by is not null)
  )
);
create index property_settings_tenant_idx on public.property_settings (tenant_id);

create or replace function app_private.normalize_property_domain()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.hostname := lower(split_part(btrim(new.hostname), ':', 1));
  new.subdomain := nullif(lower(btrim(new.subdomain)), '');
  if new.verification_status = 'verified' and new.verified_at is null then
    new.verified_at := now();
  end if;
  return new;
end;
$$;

create or replace function app_private.prevent_property_domain_scope_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.property_id is distinct from old.property_id then
    raise exception 'property domain ownership is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app_private.prevent_property_settings_scope_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.property_id is distinct from old.property_id then
    raise exception 'property settings ownership is immutable' using errcode = '23514';
  end if;
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger property_domains_normalize before insert or update on public.property_domains
for each row execute function app_private.normalize_property_domain();
create trigger property_domains_set_updated_at before update on public.property_domains
for each row execute function app_private.set_updated_at();
create trigger property_domains_immutable_scope before update on public.property_domains
for each row execute function app_private.prevent_property_domain_scope_change();
create trigger property_settings_set_updated_at before update on public.property_settings
for each row execute function app_private.set_updated_at();
create trigger property_settings_immutable_scope before update on public.property_settings
for each row execute function app_private.prevent_property_settings_scope_change();

create or replace function app_private.can_manage_property(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin()
    or exists (
      select 1
      from public.properties property
      where property.id = p_property_id
        and app_private.is_tenant_admin(property.tenant_id)
    )
    or app_private.has_property_role(p_property_id, 'property_ld_manager');
$$;

create or replace function public.resolve_property_context(p_hostname text)
returns table (
  tenant_id uuid,
  property_id uuid,
  hostname text,
  name_zh text,
  name_en text,
  short_name text,
  brand text,
  city text,
  country_region text,
  timezone text,
  default_language text,
  logo_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    domain.tenant_id,
    domain.property_id,
    domain.hostname,
    property.name_zh,
    property.name_en,
    coalesce(property.short_name, property.name_zh),
    property.brand,
    property.city,
    property.country_region,
    property.timezone,
    property.default_language,
    null::text
  from public.property_domains domain
  join public.properties property
    on property.id = domain.property_id and property.tenant_id = domain.tenant_id
  join public.tenants tenant on tenant.id = domain.tenant_id
  where domain.hostname = lower(split_part(btrim(p_hostname), ':', 1))
    and domain.is_active
    and domain.verification_status = 'verified'
    and property.status = 'active'
    and tenant.status = 'active'
  limit 1;
$$;

revoke execute on function app_private.normalize_property_domain() from public, anon, authenticated;
revoke execute on function app_private.prevent_property_domain_scope_change() from public, anon, authenticated;
revoke execute on function app_private.prevent_property_settings_scope_change() from public, anon, authenticated;
revoke execute on function app_private.can_manage_property(uuid) from public, anon;
grant execute on function app_private.can_manage_property(uuid) to authenticated;
revoke all on function public.resolve_property_context(text) from public, anon, authenticated;
grant execute on function public.resolve_property_context(text) to anon, authenticated;

revoke all on public.property_domains, public.property_settings from anon, authenticated;
grant select, insert, update on public.property_domains to authenticated;
grant select, insert, update on public.property_settings to authenticated;

alter table public.property_domains enable row level security;
alter table public.property_settings enable row level security;
alter table public.property_domains force row level security;
alter table public.property_settings force row level security;

create policy property_domains_select on public.property_domains for select to authenticated
using (
  (select app_private.is_platform_admin()) or
  (select app_private.is_tenant_admin(tenant_id)) or
  (select app_private.is_property_member(property_id))
);
create policy property_domains_insert on public.property_domains for insert to authenticated
with check ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)));
create policy property_domains_update on public.property_domains for update to authenticated
using ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)))
with check ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)));

create policy property_settings_select on public.property_settings for select to authenticated
using (
  (select app_private.is_platform_admin()) or
  (select app_private.is_tenant_admin(tenant_id)) or
  (select app_private.is_property_member(property_id))
);
create policy property_settings_insert on public.property_settings for insert to authenticated
with check ((select app_private.can_manage_property(property_id)));
create policy property_settings_update on public.property_settings for update to authenticated
using ((select app_private.can_manage_property(property_id)))
with check ((select app_private.can_manage_property(property_id)));

create policy properties_update_property_ld_manager on public.properties for update to authenticated
using ((select app_private.has_property_role(id, 'property_ld_manager')))
with check ((select app_private.has_property_role(id, 'property_ld_manager')));
