begin;
set local role hotel_ld_migration_owner;

create function app_private.actor_uuid_setting_or_null(p_name text)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_raw text;
begin
  if p_name is null or p_name not in (
    'app.actor_auth_user_id',
    'app.actor_property_id',
    'app.actor_request_id'
  ) then
    raise exception using errcode = '42501', message = 'ACTOR_CONTEXT_INVALID';
  end if;

  v_raw := pg_catalog.current_setting(p_name, true);
  if v_raw is null or pg_catalog.btrim(v_raw) = '' then
    return null;
  end if;

  begin
    return v_raw::uuid;
  exception
    when invalid_text_representation then
      raise exception using errcode = '42501', message = 'ACTOR_CONTEXT_INVALID';
  end;
end
$function$;

create function app_private.current_actor_auth_user_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_value uuid;
begin
  v_value := app_private.actor_uuid_setting_or_null('app.actor_auth_user_id');
  if v_value is null then
    raise exception using errcode = '42501', message = 'ACTOR_CONTEXT_REQUIRED';
  end if;
  return v_value;
end
$function$;

create function app_private.current_actor_property_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_value uuid;
begin
  v_value := app_private.actor_uuid_setting_or_null('app.actor_property_id');
  if v_value is null then
    raise exception using errcode = '42501', message = 'ACTOR_CONTEXT_REQUIRED';
  end if;
  return v_value;
end
$function$;

create function app_private.current_actor_request_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_value uuid;
begin
  v_value := app_private.actor_uuid_setting_or_null('app.actor_request_id');
  if v_value is null then
    raise exception using errcode = '42501', message = 'ACTOR_CONTEXT_REQUIRED';
  end if;
  return v_value;
end
$function$;

create function app_private.assert_actor_context()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if session_user <> 'hotel_ld_application' then
    raise exception using errcode = '42501', message = 'CANONICAL_RUNTIME_REQUIRED';
  end if;
  perform app_private.current_actor_auth_user_id();
  perform app_private.current_actor_property_id();
  perform app_private.current_actor_request_id();
end
$function$;

revoke all on function app_private.actor_uuid_setting_or_null(text) from public;
revoke all on function app_private.current_actor_auth_user_id() from public;
revoke all on function app_private.current_actor_property_id() from public;
revoke all on function app_private.current_actor_request_id() from public;
revoke all on function app_private.assert_actor_context() from public;

select pg_catalog.set_config('app.actor_auth_user_id', '', true);
select pg_catalog.set_config('app.actor_property_id', '', true);
select pg_catalog.set_config('app.actor_request_id', '', true);

commit;
