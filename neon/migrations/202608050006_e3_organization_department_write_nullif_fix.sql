/*
 * E3 Organization migration — Phase 2A runtime syntax correction.
 *
 * Scope:
 * - Repair only the two Phase 2A routines whose PL/pgSQL bodies qualified the
 *   SQL NULLIF syntax construct as though it were a pg_catalog function.
 * - Preserve routine owners, SECURITY mode, search_path, ACLs, grants, RLS,
 *   Actor Context, and runtime-role topology.
 *
 * This patch is safe after the corrected 005 migration too: it becomes a
 * validated no-op when neither target definition contains pg_catalog.nullif.
 */

begin;

do $e3_phase2a_nullif_preflight$
declare
  v_count integer;
begin
  if current_database() <> 'neondb'
     or session_user <> 'neondb_owner'
     or current_user <> 'neondb_owner' then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_NULLIF_BOOTSTRAP_IDENTITY_REQUIRED';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace namespace
    on namespace.oid = routine.pronamespace
  join pg_catalog.pg_roles owner_role
    on owner_role.oid = routine.proowner
  where routine.oid = any (array[
    pg_catalog.to_regprocedure(
      'app_private.prepare_department_insert()'
    ),
    pg_catalog.to_regprocedure(
      'public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean)'
    )
  ]::oid[])
    and owner_role.rolname = 'hotel_ld_migration_owner'
    and routine.proconfig = array['search_path=""']::text[]
    and (
      namespace.nspname = 'app_private'
      and routine.proname = 'prepare_department_insert'
      and not routine.prosecdef
      or namespace.nspname = 'public'
      and routine.proname = 'update_neon_organization_department'
      and routine.prosecdef
    );

  if v_count <> 2 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_NULLIF_TARGET_DRIFT';
  end if;
end
$e3_phase2a_nullif_preflight$;

set local role hotel_ld_migration_owner;

do $e3_phase2a_nullif_repair$
declare
  v_signature text;
  v_oid regprocedure;
  v_definition text;
begin
  foreach v_signature in array array[
    'app_private.prepare_department_insert()',
    'public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean)'
  ]::text[] loop
    v_oid := pg_catalog.to_regprocedure(v_signature);
    if v_oid is null then
      raise exception using errcode = 'P2000',
        message = 'E3_PHASE2A_NULLIF_TARGET_MISSING';
    end if;

    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    if pg_catalog.strpos(v_definition, 'pg_catalog.nullif(') > 0 then
      execute pg_catalog.replace(
        v_definition,
        'pg_catalog.nullif(',
        'nullif('
      );
    end if;
  end loop;
end
$e3_phase2a_nullif_repair$;

reset role;

do $e3_phase2a_nullif_postflight$
declare
  v_oid regprocedure;
begin
  foreach v_oid in array array[
    pg_catalog.to_regprocedure(
      'app_private.prepare_department_insert()'
    ),
    pg_catalog.to_regprocedure(
      'public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean)'
    )
  ]::regprocedure[] loop
    if pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(v_oid),
      'pg_catalog.nullif('
    ) > 0 then
      raise exception using errcode = '42501',
        message = 'E3_PHASE2A_NULLIF_REPAIR_FAILED';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc routine
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        routine.proacl,
        pg_catalog.acldefault('f', routine.proowner)
      )
    ) acl
    where routine.oid = pg_catalog.to_regprocedure(
      'public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean)'
    )
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'hotel_ld_application',
    'public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'hotel_ld_application',
    'app_private.prepare_department_insert()',
    'EXECUTE'
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_NULLIF_ACL_DRIFT';
  end if;
end
$e3_phase2a_nullif_postflight$;

commit;

/* Rollback: replace only these two routines with the reviewed definitions
 * from migration 005. Do not alter Actor Context, RLS, grants, or roles. */
