/* E4B hardening: preserve the applied 012 migration and correct write lock order. */
begin;

do $e4_hardening_preflight$ begin
  if current_database() <> 'neondb' or current_user <> 'neondb_owner' or session_user <> 'neondb_owner' then
    raise exception using errcode='42501',message='E4_POSITION_WRITE_HARDENING_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;
  if not pg_catalog.pg_has_role(current_user,'hotel_ld_migration_owner','SET')
     or pg_catalog.to_regprocedure('public.save_neon_position_with_departments(text,uuid,uuid,uuid,bigint,uuid,text,text,text,text,boolean,uuid[])') is null then
    raise exception using errcode='42501',message='E4_POSITION_WRITE_HARDENING_PREREQUISITE_MISSING';
  end if;
end $e4_hardening_preflight$;

set local role hotel_ld_migration_owner;

/* Canonical lock order for an update: property -> family -> position -> departments -> assignments. */
create or replace function public.save_neon_position_with_departments(p_host text,p_tenant uuid,p_property uuid,p_id uuid,p_expected bigint,p_family uuid,p_code text,p_name text,p_name_en text,p_grade text,p_active boolean,p_departments uuid[])
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare
  v public.positions%rowtype;
  v_id uuid;
  v_before bigint;
  v_count integer := 0;
  v_ids uuid[] := coalesce(p_departments,'{}'::uuid[]);
begin
  perform app_private.assert_neon_organization_runtime_session();
  perform app_private.assert_actor_context();
  perform app_private.assert_neon_organization_hostname(p_host);
  perform app_private.assert_neon_organization_manager();

  if p_property <> app_private.current_actor_property_id()
     or nullif(btrim(p_code),'') is null
     or nullif(btrim(p_name),'') is null then
    raise exception using errcode='P2006',message='NEON_POSITION_INPUT_INVALID';
  end if;

  perform 1 from public.properties
  where id=p_property and tenant_id=p_tenant and status::text='active'
  for key share;
  if not found then raise exception using errcode='42501',message='NEON_POSITION_PROPERTY_FORBIDDEN'; end if;

  if cardinality(v_ids) <> cardinality(array(select distinct x from unnest(v_ids) x)) then
    raise exception using errcode='P2006',message='NEON_POSITION_DUPLICATE_DEPARTMENTS';
  end if;

  if p_family is not null then
    perform 1 from public.position_families
    where id=p_family and tenant_id=p_tenant and property_id=p_property and is_active
    for key share;
    if not found then raise exception using errcode='P2006',message='NEON_POSITION_FAMILY_INVALID'; end if;
  end if;

  if p_id is null then
    if coalesce(p_expected,0) <> 0 then raise exception using errcode='P2002',message='NEON_POSITION_STALE'; end if;
  else
    select * into v from public.positions where id=p_id and property_id=p_property for update;
    if not found then raise exception using errcode='P2000',message='NEON_POSITION_NOT_FOUND'; end if;
    if v.version <> p_expected then raise exception using errcode='P2002',message='NEON_POSITION_STALE'; end if;
    v_before := v.version;
    v_id := v.id;
  end if;

  perform 1 from public.departments
  where id=any(v_ids) and tenant_id=p_tenant and property_id=p_property and is_active
  order by id for key share;
  if (select count(*) from public.departments
      where id=any(v_ids) and tenant_id=p_tenant and property_id=p_property and is_active) <> cardinality(v_ids) then
    raise exception using errcode='P2006',message='NEON_POSITION_DEPARTMENT_INVALID';
  end if;

  if p_id is null then
    insert into public.positions(tenant_id,property_id,position_family_id,code,name_zh,name_en,grade_or_band,is_active,created_by,updated_by)
    values(p_tenant,p_property,p_family,lower(btrim(p_code)),btrim(p_name),nullif(btrim(p_name_en),''),nullif(btrim(p_grade),''),coalesce(p_active,true),app_private.current_actor_auth_user_id(),app_private.current_actor_auth_user_id())
    returning * into v;
    v_id := v.id;
  else
    perform 1 from public.position_department_assignments
    where position_id=v_id order by department_id for update;
    select count(*) into v_count from public.position_department_assignments where position_id=v_id;

    update public.positions
    set position_family_id=p_family,
        code=lower(btrim(p_code)),
        name_zh=btrim(p_name),
        name_en=nullif(btrim(p_name_en),''),
        grade_or_band=nullif(btrim(p_grade),''),
        is_active=coalesce(p_active,true),
        updated_by=app_private.current_actor_auth_user_id(),
        version=version+1
    where id=v_id
    returning * into v;
  end if;

  delete from public.position_department_assignments where position_id=v_id;
  insert into public.position_department_assignments(tenant_id,property_id,position_id,department_id,is_primary)
  select p_tenant,p_property,v_id,x,n=1 from unnest(v_ids) with ordinality d(x,n);

  perform app_private.append_neon_position_write_audit(
    'position',v_id,case when p_id is null then 'create' else 'update' end,
    v_before,v.version,case when p_id is null then 0 else v_count end,cardinality(v_ids),
    array['position_family_id','code','name_zh','name_en','grade_or_band','is_active','department_assignments']
  );

  return jsonb_build_object(
    'id',v.id,'tenant_id',v.tenant_id,'property_id',v.property_id,
    'position_family_id',v.position_family_id,'code',v.code,'name_zh',v.name_zh,
    'name_en',v.name_en,'grade_or_band',v.grade_or_band,'is_active',v.is_active,
    'version',v.version,
    'department_ids',coalesce((select jsonb_agg(a.department_id order by a.is_primary desc,a.department_id)
      from public.position_department_assignments a where a.position_id=v.id),'[]'::jsonb)
  );
exception when unique_violation then
  raise exception using errcode='P2006',message='NEON_POSITION_CODE_CONFLICT';
end $f$;

revoke all on function public.save_neon_position_with_departments(text,uuid,uuid,uuid,bigint,uuid,text,text,text,text,boolean,uuid[]) from public,authenticated,neondb_owner,hotel_ld_people_read,hotel_ld_application,hotel_ld_readonly;
grant execute on function public.save_neon_position_with_departments(text,uuid,uuid,uuid,bigint,uuid,text,text,text,text,boolean,uuid[]) to hotel_ld_application;
reset role;

do $e4_hardening_postflight$ begin
  if not exists(
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid=pg_catalog.to_regprocedure('public.save_neon_position_with_departments(text,uuid,uuid,uuid,bigint,uuid,text,text,text,text,boolean,uuid[])')
      and r.rolname='hotel_ld_migration_owner'
      and p.prosecdef
      and p.proconfig=array['search_path=""']::text[]
      and not pg_catalog.has_function_privilege('public',p.oid,'EXECUTE')
      and pg_catalog.has_function_privilege('hotel_ld_application',p.oid,'EXECUTE')
  ) then raise exception using errcode='42501',message='E4_POSITION_WRITE_HARDENING_ACL_DRIFT'; end if;
end $e4_hardening_postflight$;

commit;
