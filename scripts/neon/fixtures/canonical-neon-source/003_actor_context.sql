create function app_private.install_actor_context(p_user uuid, p_property uuid, p_request uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select set_config('app.actor_auth_user_id', p_user::text, true);
  select set_config('app.actor_property_id', p_property::text, true);
  select set_config('app.actor_request_id', p_request::text, true);
$$;

revoke all on function app_private.install_actor_context(uuid, uuid, uuid) from public;
