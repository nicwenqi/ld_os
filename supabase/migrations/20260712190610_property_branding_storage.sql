create table public.property_brand_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  object_path text not null,
  original_file_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  version integer not null,
  is_current boolean not null default true,
  retention_until timestamptz,
  uploaded_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_brand_assets_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint property_brand_assets_object_path_key unique (object_path),
  constraint property_brand_assets_property_version_key unique (property_id, version),
  constraint property_brand_assets_original_name_check check (btrim(original_file_name) <> ''),
  constraint property_brand_assets_mime_check check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  constraint property_brand_assets_size_check check (byte_size between 1 and 2097152),
  constraint property_brand_assets_version_check check (version > 0),
  constraint property_brand_assets_current_retention_check check (not is_current or retention_until is null),
  constraint property_brand_assets_path_check check (
    object_path = tenant_id::text || '/' || property_id::text || '/branding/' || id::text ||
      '/logo-v' || version::text || case mime_type
        when 'image/png' then '.png'
        when 'image/jpeg' then '.jpg'
        when 'image/webp' then '.webp'
        else ''
      end
  )
);
create unique index property_brand_assets_current_property_uidx
  on public.property_brand_assets (property_id) where is_current;
create index property_brand_assets_property_created_idx
  on public.property_brand_assets (property_id, created_at desc);
create index property_brand_assets_retention_idx
  on public.property_brand_assets (retention_until) where not is_current and retention_until is not null;

create or replace function app_private.retire_previous_property_brand_asset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_current then
    update public.property_brand_assets
    set is_current = false,
        retention_until = now() + interval '30 days',
        updated_at = now()
    where property_id = new.property_id and is_current;
  end if;
  return new;
end;
$$;

create trigger property_brand_assets_retire_previous
before insert on public.property_brand_assets
for each row execute function app_private.retire_previous_property_brand_asset();

create or replace function app_private.can_manage_property_brand_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  parts text[];
  object_tenant_id uuid;
  object_property_id uuid;
begin
  parts := string_to_array(p_name, '/');
  if array_length(parts, 1) <> 5
    or parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or parts[3] <> 'branding'
    or parts[4] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or parts[5] !~ '^logo-v[1-9][0-9]*\.(png|jpg|webp)$' then
    return false;
  end if;

  object_tenant_id := parts[1]::uuid;
  object_property_id := parts[2]::uuid;
  return app_private.can_manage_property(object_property_id)
    and exists (
      select 1 from public.properties property
      where property.id = object_property_id and property.tenant_id = object_tenant_id
    );
exception when invalid_text_representation then
  return false;
end;
$$;

revoke execute on function app_private.retire_previous_property_brand_asset() from public, anon, authenticated;
revoke execute on function app_private.can_manage_property_brand_object(text) from public, anon;
grant execute on function app_private.can_manage_property_brand_object(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-brand-assets',
  'property-brand-assets',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
);

create policy property_brand_assets_metadata_select on storage.objects for select to authenticated
using (bucket_id = 'property-brand-assets' and (select app_private.can_manage_property_brand_object(name)));
create policy property_brand_assets_insert on storage.objects for insert to authenticated
with check (bucket_id = 'property-brand-assets' and (select app_private.can_manage_property_brand_object(name)));
create policy property_brand_assets_update on storage.objects for update to authenticated
using (bucket_id = 'property-brand-assets' and (select app_private.can_manage_property_brand_object(name)))
with check (bucket_id = 'property-brand-assets' and (select app_private.can_manage_property_brand_object(name)));
create policy property_brand_assets_delete on storage.objects for delete to authenticated
using (bucket_id = 'property-brand-assets' and (select app_private.can_manage_property_brand_object(name)));

revoke all on public.property_brand_assets from anon, authenticated;
grant select, insert, delete on public.property_brand_assets to authenticated;

alter table public.property_brand_assets enable row level security;
alter table public.property_brand_assets force row level security;

create policy property_brand_assets_select on public.property_brand_assets for select to authenticated
using (
  (select app_private.is_platform_admin()) or
  (select app_private.is_tenant_admin(tenant_id)) or
  (select app_private.is_property_member(property_id))
);
create policy property_brand_assets_insert on public.property_brand_assets for insert to authenticated
with check ((select app_private.can_manage_property(property_id)));
create policy property_brand_assets_delete on public.property_brand_assets for delete to authenticated
using (
  (select app_private.can_manage_property(property_id)) and
  not is_current and retention_until is not null and retention_until <= now()
);

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
    case when asset.object_path is null then null else
      '/storage/v1/object/public/property-brand-assets/' || asset.object_path
    end
  from public.property_domains domain
  join public.properties property
    on property.id = domain.property_id and property.tenant_id = domain.tenant_id
  join public.tenants tenant on tenant.id = domain.tenant_id
  left join lateral (
    select brand.object_path
    from public.property_brand_assets brand
    where brand.property_id = domain.property_id and brand.is_current
    limit 1
  ) asset on true
  where domain.hostname = lower(split_part(btrim(p_hostname), ':', 1))
    and domain.is_active
    and domain.verification_status = 'verified'
    and property.status = 'active'
    and tenant.status = 'active'
  limit 1;
$$;

revoke all on function public.resolve_property_context(text) from public, anon, authenticated;
grant execute on function public.resolve_property_context(text) to anon, authenticated;
