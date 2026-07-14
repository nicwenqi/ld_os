create or replace function public.save_property_initialization_navigation(
  p_property_id uuid,
  p_last_active_step smallint,
  p_expected_version bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_version bigint;
begin
  if p_last_active_step not between 1 and 8 then
    raise exception 'P4020: invalid initialization navigation step' using errcode = 'P4020';
  end if;

  select tenant_id, version into v_tenant_id, v_version
  from public.property_settings
  where property_id = p_property_id
  for update;

  if v_tenant_id is null or not app_private.can_manage_property(p_property_id) then
    raise exception 'P4021: property initialization navigation access denied' using errcode = 'P4021';
  end if;
  if p_expected_version is not null and p_expected_version <> v_version then
    raise exception 'P4022: initialization navigation is stale' using errcode = 'P4022';
  end if;

  update public.property_settings
  set initialization_last_active_step = p_last_active_step,
      updated_by = auth.uid()
  where property_id = p_property_id;

  return public.get_property_initialization_progress(p_property_id);
end;
$$;

revoke all on function public.save_property_initialization_navigation(uuid,smallint,bigint) from public, anon;
grant execute on function public.save_property_initialization_navigation(uuid,smallint,bigint) to authenticated;
