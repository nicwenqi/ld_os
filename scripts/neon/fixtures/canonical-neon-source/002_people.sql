create type public.property_status as enum ('active', 'inactive');

create table public.properties (
  id uuid primary key,
  status public.property_status not null
);

alter table public.properties enable row level security;
alter table public.properties force row level security;

create policy properties_tenant_scope on public.properties
  for select to hotel_ld_migration_owner using (true);

create function public.read_people(p_host text)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select '{}'::jsonb $$;

create function app_private.touch_properties()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$ begin return new; end $$;

create trigger properties_touch
before update on public.properties
for each row execute function app_private.touch_properties();

revoke all on table public.properties from hotel_ld_application;
revoke all on function public.read_people(text) from public;
grant execute on function public.read_people(text) to hotel_ld_application;
