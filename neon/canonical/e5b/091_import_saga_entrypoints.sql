begin;
set local role hotel_ld_migration_owner;
set local check_function_bodies = off;

create function app_private.assert_neon_import_manager(p_hostname text)
returns table (
  resolved_tenant_id uuid,
  resolved_property_id uuid,
  resolved_auth_user_id uuid,
  resolved_actor_user_id uuid,
  resolved_request_id uuid
)
language plpgsql stable security invoker set search_path = ''
as $function$
begin
  perform app_private.assert_actor_context();
  perform app_private.assert_neon_property_hostname(p_hostname);
  perform app_private.assert_neon_property_manager();

  return query
  select property.tenant_id,
         property.id,
         account.auth_user_id,
         account.user_id,
         app_private.current_actor_request_id()
  from public.properties property
  join public.user_accounts account
    on account.tenant_id = property.tenant_id
   and account.property_id = property.id
   and account.auth_user_id = app_private.current_actor_auth_user_id()
   and account.account_status = 'active'
  where property.id = app_private.current_actor_property_id()
    and property.status in ('initializing', 'active');

  if not found then
    raise exception using errcode = '42501', message = 'NEON_IMPORT_MANAGER_FORBIDDEN';
  end if;
end
$function$;

create function app_private.neon_import_saga_state(p_batch_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'batch_id', batch.id,
    'storage_lifecycle', batch.storage_lifecycle,
    'workbook_lifecycle', batch.workbook_lifecycle,
    'verification_status', batch.verification_status,
    'version', batch.version
  )
  from public.import_batches batch
  where batch.id = p_batch_id
    and batch.property_id = app_private.current_actor_property_id()
$function$;

create function app_private.append_neon_import_activity(
  p_batch_id uuid,
  p_event_type text,
  p_previous_storage_lifecycle public.import_storage_lifecycle,
  p_previous_workbook_lifecycle public.import_workbook_lifecycle,
  p_details jsonb
)
returns void language plpgsql volatile security invoker set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
begin
  select account.user_id into v_actor_user_id
  from public.user_accounts account
  where account.auth_user_id = app_private.current_actor_auth_user_id()
    and account.property_id = app_private.current_actor_property_id()
    and account.account_status = 'active';

  insert into app_private.import_activity_events (
    request_id, auth_user_id, actor_user_id, tenant_id, property_id, batch_id,
    event_type, previous_storage_lifecycle, next_storage_lifecycle,
    previous_workbook_lifecycle, next_workbook_lifecycle, details
  )
  select app_private.current_actor_request_id(),
         app_private.current_actor_auth_user_id(),
         v_actor_user_id,
         batch.tenant_id,
         batch.property_id,
         batch.id,
         p_event_type,
         p_previous_storage_lifecycle,
         batch.storage_lifecycle,
         p_previous_workbook_lifecycle,
         batch.workbook_lifecycle,
         pg_catalog.coalesce(p_details, '{}'::jsonb)
  from public.import_batches batch
  where batch.id = p_batch_id
    and batch.property_id = app_private.current_actor_property_id();

  if not found then
    raise exception using errcode = 'P0002', message = 'NEON_IMPORT_BATCH_NOT_FOUND';
  end if;
end
$function$;

create function public.create_neon_import_upload_intent(
  p_hostname text,
  p_batch_id uuid,
  p_original_filename text,
  p_sanitized_filename text,
  p_declared_checksum_sha256 text,
  p_declared_size_bytes bigint,
  p_declared_mime_type text,
  p_source_system text
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_property_id uuid;
  v_auth_user_id uuid;
  v_actor_user_id uuid;
  v_request_id uuid;
  v_object_path text;
begin
  select authorization.resolved_tenant_id,
         authorization.resolved_property_id,
         authorization.resolved_auth_user_id,
         authorization.resolved_actor_user_id,
         authorization.resolved_request_id
  into v_tenant_id, v_property_id, v_auth_user_id, v_actor_user_id, v_request_id
  from app_private.assert_neon_import_manager(p_hostname) authorization;

  if p_batch_id is null
    or pg_catalog.char_length(pg_catalog.btrim(pg_catalog.coalesce(p_original_filename, ''))) not between 1 and 255
    or pg_catalog.btrim(pg_catalog.coalesce(p_sanitized_filename, '')) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$'
    or pg_catalog.btrim(p_sanitized_filename) ~ '\.\.'
    or pg_catalog.btrim(p_sanitized_filename) ~ '[/\\]'
    or p_declared_checksum_sha256 !~ '^[0-9a-f]{64}$'
    or p_declared_size_bytes not between 1 and 52428800
    or pg_catalog.btrim(pg_catalog.coalesce(p_declared_mime_type, '')) not in (
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv'
    )
    or pg_catalog.char_length(pg_catalog.btrim(pg_catalog.coalesce(p_source_system, ''))) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_UPLOAD_INTENT_INVALID';
  end if;

  v_object_path := v_tenant_id::text || '/' || v_property_id::text
    || '/imports/' || p_batch_id::text || '/' || pg_catalog.btrim(p_sanitized_filename);

  insert into public.import_batches (
    id, tenant_id, property_id, source_system, original_filename, sanitized_filename,
    object_path, declared_checksum_sha256, declared_size_bytes, declared_mime_type,
    created_by_auth_user_id, created_request_id
  ) values (
    p_batch_id, v_tenant_id, v_property_id, pg_catalog.btrim(p_source_system),
    pg_catalog.btrim(p_original_filename), pg_catalog.btrim(p_sanitized_filename),
    v_object_path, p_declared_checksum_sha256, p_declared_size_bytes,
    pg_catalog.btrim(p_declared_mime_type), v_auth_user_id, v_request_id
  );

  insert into app_private.import_storage_operations (
    tenant_id, property_id, batch_id, object_path, originating_request_id
  ) values (v_tenant_id, v_property_id, p_batch_id, v_object_path, v_request_id);

  perform app_private.append_neon_import_activity(
    p_batch_id, 'upload_intent_created', null, null,
    pg_catalog.jsonb_build_object('declared_size_bytes', p_declared_size_bytes)
  );

  return pg_catalog.jsonb_build_object(
    'batch_id', p_batch_id,
    'bucket', 'property-import-files',
    'object_path', v_object_path,
    'storage_lifecycle', 'intent_created',
    'workbook_lifecycle', 'intent_created',
    'verification_status', 'pending',
    'version', 1
  );
end
$function$;

create function public.record_neon_import_object_uploaded(
  p_hostname text,
  p_batch_id uuid,
  p_expected_version bigint
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_batch public.import_batches%rowtype;
begin
  perform 1 from app_private.assert_neon_import_manager(p_hostname);

  select batch.* into v_batch
  from public.import_batches batch
  where batch.id = p_batch_id
    and batch.property_id = app_private.current_actor_property_id()
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'NEON_IMPORT_BATCH_NOT_FOUND';
  end if;
  if p_expected_version is null or v_batch.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'NEON_IMPORT_BATCH_STALE';
  end if;
  if v_batch.storage_lifecycle <> 'intent_created' then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_UPLOAD_STATE_INVALID';
  end if;

  update public.import_batches
  set storage_lifecycle = 'uploaded_unverified', version = version + 1
  where id = p_batch_id and property_id = app_private.current_actor_property_id();

  perform app_private.append_neon_import_activity(
    p_batch_id, 'object_uploaded', v_batch.storage_lifecycle,
    v_batch.workbook_lifecycle, '{}'::jsonb
  );
  return app_private.neon_import_saga_state(p_batch_id);
end
$function$;

create function public.record_neon_import_object_verification(
  p_hostname text,
  p_batch_id uuid,
  p_expected_version bigint,
  p_verified_checksum_sha256 text,
  p_verified_size_bytes bigint,
  p_verified_mime_type text,
  p_status text,
  p_failure_reason text
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_operation app_private.import_storage_operations%rowtype;
  v_batch public.import_batches%rowtype;
  v_passed boolean;
  v_failure_reason text;
begin
  perform 1 from app_private.assert_neon_import_manager(p_hostname);

  if p_expected_version is null or p_status is null or p_status not in ('passed', 'failed') then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_VERIFICATION_INPUT_INVALID';
  end if;
  if p_status = 'passed' and (
    p_verified_checksum_sha256 !~ '^[0-9a-f]{64}$'
    or p_verified_size_bytes not between 1 and 52428800
    or pg_catalog.btrim(pg_catalog.coalesce(p_verified_mime_type, '')) not in (
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv'
    )
  ) then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_VERIFICATION_INPUT_INVALID';
  end if;
  if p_status = 'failed' and (
    (p_verified_checksum_sha256 is not null and p_verified_checksum_sha256 !~ '^[0-9a-f]{64}$')
    or (p_verified_size_bytes is not null and p_verified_size_bytes not between 1 and 52428800)
    or (p_verified_mime_type is not null and pg_catalog.btrim(p_verified_mime_type) not in (
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv'
    ))
  ) then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_VERIFICATION_INPUT_INVALID';
  end if;

  select operation.* into v_operation
  from app_private.import_storage_operations operation
  where operation.batch_id = p_batch_id
    and operation.property_id = app_private.current_actor_property_id()
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NEON_IMPORT_BATCH_NOT_FOUND';
  end if;

  select batch.* into v_batch
  from public.import_batches batch
  where batch.id = p_batch_id
    and batch.property_id = app_private.current_actor_property_id()
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'NEON_IMPORT_BATCH_NOT_FOUND';
  end if;
  if v_batch.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'NEON_IMPORT_BATCH_STALE';
  end if;
  if v_batch.storage_lifecycle <> 'uploaded_unverified'
    or v_batch.verification_status <> 'pending' then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_VERIFICATION_STATE_INVALID';
  end if;

  v_passed := p_status = 'passed'
    and p_verified_checksum_sha256 = v_batch.declared_checksum_sha256
    and p_verified_size_bytes = v_batch.declared_size_bytes
    and pg_catalog.btrim(p_verified_mime_type) = v_batch.declared_mime_type;
  v_failure_reason := pg_catalog.left(pg_catalog.coalesce(
    pg_catalog.nullif(pg_catalog.btrim(p_failure_reason), ''),
    case when p_status = 'failed' then 'verification_failed'
      else 'declared_and_verified_evidence_mismatch' end
  ), 500);

  if v_passed then
    update public.import_batches
    set verified_checksum_sha256 = p_verified_checksum_sha256,
        verified_size_bytes = p_verified_size_bytes,
        verified_mime_type = pg_catalog.btrim(p_verified_mime_type),
        verified_at = pg_catalog.transaction_timestamp(),
        verification_status = 'passed',
        storage_lifecycle = 'verified',
        failure_reason = null,
        version = version + 1
    where id = p_batch_id and property_id = app_private.current_actor_property_id();
  else
    update public.import_batches
    set verified_checksum_sha256 = p_verified_checksum_sha256,
        verified_size_bytes = p_verified_size_bytes,
        verified_mime_type = nullif(pg_catalog.btrim(p_verified_mime_type), ''),
        verification_status = 'failed',
        storage_lifecycle = 'verification_failed',
        workbook_lifecycle = 'failed',
        failure_reason = v_failure_reason,
        version = version + 1
    where id = p_batch_id and property_id = app_private.current_actor_property_id();

    update app_private.import_storage_operations operation
    set cleanup_state = 'cleanup_pending',
        next_attempt_at = pg_catalog.transaction_timestamp(),
        claim_id = null,
        lease_expires_at = null,
        last_error_code = 'verification_failed',
        last_error_message = v_failure_reason,
        last_request_id = app_private.current_actor_request_id(),
        completed_at = null,
        updated_at = pg_catalog.transaction_timestamp(),
        version = operation.version + 1
    where operation.id = v_operation.id
      and operation.property_id = app_private.current_actor_property_id();
  end if;

  perform app_private.append_neon_import_activity(
    p_batch_id,
    case when v_passed then 'object_verified' else 'object_verification_failed' end,
    v_batch.storage_lifecycle, v_batch.workbook_lifecycle,
    pg_catalog.jsonb_build_object(
      'verification_status', case when v_passed then 'passed' else 'failed' end,
      'verified_size_bytes', p_verified_size_bytes
    )
  );
  return app_private.neon_import_saga_state(p_batch_id);
end
$function$;

create function public.mark_neon_import_cleanup_pending(
  p_hostname text,
  p_batch_id uuid,
  p_expected_version bigint,
  p_reason text
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_operation app_private.import_storage_operations%rowtype;
  v_batch public.import_batches%rowtype;
  v_reason text;
begin
  perform 1 from app_private.assert_neon_import_manager(p_hostname);
  v_reason := pg_catalog.left(pg_catalog.coalesce(
    pg_catalog.nullif(pg_catalog.btrim(p_reason), ''), 'cleanup_requested'
  ), 500);

  select operation.* into v_operation
  from app_private.import_storage_operations operation
  where operation.batch_id = p_batch_id
    and operation.property_id = app_private.current_actor_property_id()
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NEON_IMPORT_BATCH_NOT_FOUND';
  end if;

  select batch.* into v_batch
  from public.import_batches batch
  where batch.id = p_batch_id
    and batch.property_id = app_private.current_actor_property_id()
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'NEON_IMPORT_BATCH_NOT_FOUND';
  end if;
  if v_batch.storage_lifecycle = 'linked' then
    raise exception using errcode = '42501', message = 'NEON_IMPORT_LINKED_OBJECT_CLEANUP_FORBIDDEN';
  end if;
  if v_batch.storage_lifecycle = 'cleanup_pending' then
    return app_private.neon_import_saga_state(p_batch_id);
  end if;
  if p_expected_version is null or v_batch.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'NEON_IMPORT_BATCH_STALE';
  end if;
  if v_batch.storage_lifecycle not in (
    'intent_created', 'uploaded_unverified', 'verification_failed', 'verified', 'cleanup_failed'
  ) then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_CLEANUP_STATE_INVALID';
  end if;

  update public.import_batches
  set storage_lifecycle = 'cleanup_pending',
      workbook_lifecycle = 'failed',
      version = version + 1
  where id = p_batch_id and property_id = app_private.current_actor_property_id();

  update app_private.import_storage_operations operation
  set cleanup_state = 'cleanup_pending',
      next_attempt_at = pg_catalog.transaction_timestamp(),
      claim_id = null,
      lease_expires_at = null,
      last_error_code = 'cleanup_requested',
      last_error_message = v_reason,
      last_request_id = app_private.current_actor_request_id(),
      completed_at = null,
      updated_at = pg_catalog.transaction_timestamp(),
      version = operation.version + 1
  where operation.id = v_operation.id
    and operation.property_id = app_private.current_actor_property_id();

  perform app_private.append_neon_import_activity(
    p_batch_id, 'cleanup_pending', v_batch.storage_lifecycle,
    v_batch.workbook_lifecycle, pg_catalog.jsonb_build_object('reason', v_reason)
  );
  return app_private.neon_import_saga_state(p_batch_id);
end
$function$;

create function public.claim_neon_import_cleanup(
  p_hostname text,
  p_batch_id uuid,
  p_limit integer,
  p_claim_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_candidate record;
  v_claims jsonb := '[]'::jsonb;
  v_now timestamptz;
  v_lease_expires_at timestamptz;
  v_attempt_count integer;
  v_previous_storage_lifecycle public.import_storage_lifecycle;
begin
  perform 1 from app_private.assert_neon_import_manager(p_hostname);
  if p_claim_id is null or p_limit not between 1 and 50 then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_CLEANUP_CLAIM_INVALID';
  end if;

  for v_candidate in
    with claimable_operations as materialized (
      select operation.id
      from app_private.import_storage_operations operation
      where operation.property_id = app_private.current_actor_property_id()
        and (p_batch_id is null or operation.batch_id = p_batch_id)
        and (
          (operation.cleanup_state in ('cleanup_pending', 'cleanup_failed')
            and operation.next_attempt_at is not null
            and operation.next_attempt_at <= pg_catalog.clock_timestamp())
          or (operation.cleanup_state = 'cleanup_in_progress'
            and operation.lease_expires_at is not null
            and operation.lease_expires_at <= pg_catalog.clock_timestamp())
        )
      order by pg_catalog.coalesce(operation.next_attempt_at, operation.lease_expires_at), operation.id
      limit p_limit
      for update skip locked
    )
    select operation.id as operation_id,
           operation.batch_id,
           operation.object_path,
           operation.cleanup_state,
           operation.attempt_count,
           operation.next_attempt_at,
           operation.lease_expires_at,
           batch.storage_bucket,
           batch.storage_lifecycle,
           batch.workbook_lifecycle
    from claimable_operations claimable
    join app_private.import_storage_operations operation
      on operation.id = claimable.id
    join public.import_batches batch
      on batch.id = operation.batch_id
     and batch.tenant_id = operation.tenant_id
     and batch.property_id = operation.property_id
    where batch.storage_lifecycle <> 'linked'
    order by pg_catalog.coalesce(operation.next_attempt_at, operation.lease_expires_at), operation.id
    for update of batch skip locked
  loop
    -- Recheck a current lease after the ledger+batch rows have been claimed.
    v_now := pg_catalog.clock_timestamp();
    if not (
      (v_candidate.cleanup_state in ('cleanup_pending', 'cleanup_failed')
        and v_candidate.next_attempt_at is not null and v_candidate.next_attempt_at <= v_now)
      or (v_candidate.cleanup_state = 'cleanup_in_progress'
        and v_candidate.lease_expires_at is not null and v_candidate.lease_expires_at <= v_now)
    ) then
      continue;
    end if;

    if v_candidate.storage_lifecycle in ('verification_failed', 'cleanup_failed') then
      v_previous_storage_lifecycle := v_candidate.storage_lifecycle;
      update public.import_batches
      set storage_lifecycle = 'cleanup_pending', version = version + 1
      where id = v_candidate.batch_id and property_id = app_private.current_actor_property_id();
      perform app_private.append_neon_import_activity(
        v_candidate.batch_id, 'cleanup_requeued', v_previous_storage_lifecycle,
        v_candidate.workbook_lifecycle,
        pg_catalog.jsonb_build_object('reason', 'cleanup_claim_reconciliation')
      );
      v_candidate.storage_lifecycle := 'cleanup_pending';
    end if;
    if v_candidate.storage_lifecycle not in ('cleanup_pending', 'cleanup_in_progress') then
      continue;
    end if;

    v_lease_expires_at := v_now + interval '5 minutes';
    update app_private.import_storage_operations operation
    set cleanup_state = 'cleanup_in_progress',
        attempt_count = operation.attempt_count + 1,
        last_attempt_at = v_now,
        next_attempt_at = null,
        claim_id = p_claim_id,
        lease_expires_at = v_lease_expires_at,
        last_request_id = app_private.current_actor_request_id(),
        last_error_code = null,
        last_error_message = null,
        completed_at = null,
        updated_at = pg_catalog.transaction_timestamp(),
        version = operation.version + 1
    where operation.id = v_candidate.operation_id
      and operation.property_id = app_private.current_actor_property_id()
    returning operation.attempt_count into v_attempt_count;

    if v_candidate.storage_lifecycle <> 'cleanup_in_progress' then
      update public.import_batches
      set storage_lifecycle = 'cleanup_in_progress', version = version + 1
      where id = v_candidate.batch_id and property_id = app_private.current_actor_property_id();
    end if;

    perform app_private.append_neon_import_activity(
      v_candidate.batch_id, 'cleanup_claimed', v_candidate.storage_lifecycle,
      v_candidate.workbook_lifecycle,
      pg_catalog.jsonb_build_object('attempt_count', v_attempt_count)
    );
    v_claims := v_claims || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'batch_id', v_candidate.batch_id,
      'operation_id', v_candidate.operation_id,
      'bucket', v_candidate.storage_bucket,
      'object_path', v_candidate.object_path,
      'claim_id', p_claim_id,
      'attempt_count', v_attempt_count,
      'lease_expires_at', v_lease_expires_at
    ));
  end loop;

  return pg_catalog.jsonb_build_object('claims', v_claims);
end
$function$;

create function public.complete_neon_import_cleanup(
  p_hostname text,
  p_batch_id uuid,
  p_operation_id uuid,
  p_claim_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_operation app_private.import_storage_operations%rowtype;
  v_batch public.import_batches%rowtype;
  v_now timestamptz;
begin
  perform 1 from app_private.assert_neon_import_manager(p_hostname);
  if p_batch_id is null or p_operation_id is null or p_claim_id is null then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_CLEANUP_COMPLETION_INVALID';
  end if;

  v_now := pg_catalog.clock_timestamp();
  select operation.* into v_operation
  from app_private.import_storage_operations operation
  where operation.id = p_operation_id
    and operation.batch_id = p_batch_id
    and operation.property_id = app_private.current_actor_property_id()
    and operation.cleanup_state = 'cleanup_in_progress'
    and operation.claim_id = p_claim_id
    and operation.lease_expires_at > v_now
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'NEON_IMPORT_CLEANUP_CLAIM_STALE';
  end if;
  select batch.* into v_batch
  from public.import_batches batch
  where batch.id = p_batch_id
    and batch.property_id = app_private.current_actor_property_id()
    and batch.storage_lifecycle = 'cleanup_in_progress'
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'NEON_IMPORT_CLEANUP_CLAIM_STALE';
  end if;

  update app_private.import_storage_operations operation
  set cleanup_state = 'cleanup_completed',
      last_request_id = app_private.current_actor_request_id(),
      claim_id = null,
      lease_expires_at = null,
      next_attempt_at = null,
      last_error_code = null,
      last_error_message = null,
      completed_at = v_now,
      updated_at = pg_catalog.transaction_timestamp(),
      version = operation.version + 1
  where operation.id = v_operation.id
    and operation.property_id = app_private.current_actor_property_id();
  update public.import_batches
  set storage_lifecycle = 'cleanup_completed', version = version + 1
  where id = p_batch_id and property_id = app_private.current_actor_property_id();

  perform app_private.append_neon_import_activity(
    p_batch_id, 'cleanup_completed', v_batch.storage_lifecycle,
    v_batch.workbook_lifecycle, pg_catalog.jsonb_build_object('attempt_count', v_operation.attempt_count)
  );
  return app_private.neon_import_saga_state(p_batch_id);
end
$function$;

create function public.fail_neon_import_cleanup(
  p_hostname text,
  p_batch_id uuid,
  p_operation_id uuid,
  p_claim_id uuid,
  p_error text,
  p_next_attempt_at timestamptz
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_operation app_private.import_storage_operations%rowtype;
  v_batch public.import_batches%rowtype;
  v_now timestamptz;
  v_error text;
begin
  perform 1 from app_private.assert_neon_import_manager(p_hostname);
  v_now := pg_catalog.clock_timestamp();
  v_error := pg_catalog.left(pg_catalog.coalesce(
    pg_catalog.nullif(pg_catalog.btrim(p_error), ''), 'storage_cleanup_failed'
  ), 500);
  if p_batch_id is null or p_operation_id is null or p_claim_id is null
    or p_next_attempt_at is null
    or p_next_attempt_at <= v_now
    or p_next_attempt_at > v_now + interval '24 hours' then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_CLEANUP_RETRY_INVALID';
  end if;

  select operation.* into v_operation
  from app_private.import_storage_operations operation
  where operation.id = p_operation_id
    and operation.batch_id = p_batch_id
    and operation.property_id = app_private.current_actor_property_id()
    and operation.cleanup_state = 'cleanup_in_progress'
    and operation.claim_id = p_claim_id
    and operation.lease_expires_at > v_now
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'NEON_IMPORT_CLEANUP_CLAIM_STALE';
  end if;
  select batch.* into v_batch
  from public.import_batches batch
  where batch.id = p_batch_id
    and batch.property_id = app_private.current_actor_property_id()
    and batch.storage_lifecycle = 'cleanup_in_progress'
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'NEON_IMPORT_CLEANUP_CLAIM_STALE';
  end if;

  update app_private.import_storage_operations operation
  set cleanup_state = 'cleanup_failed',
      last_request_id = app_private.current_actor_request_id(),
      claim_id = null,
      lease_expires_at = null,
      next_attempt_at = p_next_attempt_at,
      last_error_code = 'storage_cleanup_failed',
      last_error_message = v_error,
      updated_at = pg_catalog.transaction_timestamp(),
      version = operation.version + 1
  where operation.id = v_operation.id
    and operation.property_id = app_private.current_actor_property_id();
  update public.import_batches
  set storage_lifecycle = 'cleanup_failed', version = version + 1
  where id = p_batch_id and property_id = app_private.current_actor_property_id();

  perform app_private.append_neon_import_activity(
    p_batch_id, 'cleanup_failed', v_batch.storage_lifecycle,
    v_batch.workbook_lifecycle, pg_catalog.jsonb_build_object('next_attempt_at', p_next_attempt_at)
  );
  return app_private.neon_import_saga_state(p_batch_id);
end
$function$;

create function public.get_neon_import_workflow(
  p_hostname text,
  p_batch_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  perform 1 from app_private.assert_neon_import_manager(p_hostname);
  select pg_catalog.jsonb_build_object(
    'batch_id', batch.id,
    'file_name', batch.sanitized_filename,
    'storage_lifecycle', batch.storage_lifecycle,
    'workbook_lifecycle', batch.workbook_lifecycle,
    'verification_status', batch.verification_status,
    'checksum_status', case when batch.verification_status = 'passed' then 'verified' else batch.verification_status::text end,
    'counts', pg_catalog.jsonb_build_object(
      'sheets', batch.detected_sheet_count,
      'total', batch.total_source_rows,
      'valid', batch.valid_rows,
      'warning', batch.warning_rows,
      'error', batch.error_rows
    ),
    'cleanup_attention_required', batch.storage_lifecycle in (
      'verification_failed', 'cleanup_pending', 'cleanup_in_progress', 'cleanup_failed'
    ),
    'version', batch.version,
    'created_at', batch.created_at,
    'updated_at', batch.updated_at
  ) into v_result
  from public.import_batches batch
  where batch.id = p_batch_id
    and batch.property_id = app_private.current_actor_property_id();

  if v_result is null then return null; end if;
  perform app_private.append_neon_import_activity(
    p_batch_id, 'workflow_read', null, null, '{}'::jsonb
  );
  return v_result;
end
$function$;

create function public.list_neon_import_history(p_hostname text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_rows jsonb;
begin
  perform 1 from app_private.assert_neon_import_manager(p_hostname);
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'batch_id', batch.id,
      'file_name', batch.sanitized_filename,
      'storage_lifecycle', batch.storage_lifecycle,
      'workbook_lifecycle', batch.workbook_lifecycle,
      'verification_status', batch.verification_status,
      'checksum_status', case when batch.verification_status = 'passed' then 'verified' else batch.verification_status::text end,
      'counts', pg_catalog.jsonb_build_object(
        'sheets', batch.detected_sheet_count,
        'total', batch.total_source_rows,
        'valid', batch.valid_rows,
        'warning', batch.warning_rows,
        'error', batch.error_rows
      ),
      'cleanup_attention_required', batch.storage_lifecycle in (
        'verification_failed', 'cleanup_pending', 'cleanup_in_progress', 'cleanup_failed'
      ),
      'version', batch.version,
      'created_at', batch.created_at,
      'updated_at', batch.updated_at
    ) order by batch.created_at desc, batch.id desc
  ), '[]'::jsonb) into v_rows
  from (
    select candidate.*
    from public.import_batches candidate
    where candidate.property_id = app_private.current_actor_property_id()
    order by candidate.created_at desc, candidate.id desc
    limit 100
  ) batch;
  return pg_catalog.jsonb_build_object('rows', v_rows);
end
$function$;

alter function app_private.assert_neon_import_manager(text) owner to hotel_ld_migration_owner;
alter function app_private.neon_import_saga_state(uuid) owner to hotel_ld_migration_owner;
alter function app_private.append_neon_import_activity(uuid,text,public.import_storage_lifecycle,public.import_workbook_lifecycle,jsonb) owner to hotel_ld_migration_owner;
alter function public.create_neon_import_upload_intent(text,uuid,text,text,text,bigint,text,text) owner to hotel_ld_migration_owner;
alter function public.record_neon_import_object_uploaded(text,uuid,bigint) owner to hotel_ld_migration_owner;
alter function public.record_neon_import_object_verification(text,uuid,bigint,text,bigint,text,text,text) owner to hotel_ld_migration_owner;
alter function public.mark_neon_import_cleanup_pending(text,uuid,bigint,text) owner to hotel_ld_migration_owner;
alter function public.claim_neon_import_cleanup(text,uuid,integer,uuid) owner to hotel_ld_migration_owner;
alter function public.complete_neon_import_cleanup(text,uuid,uuid,uuid) owner to hotel_ld_migration_owner;
alter function public.fail_neon_import_cleanup(text,uuid,uuid,uuid,text,timestamptz) owner to hotel_ld_migration_owner;
alter function public.get_neon_import_workflow(text,uuid) owner to hotel_ld_migration_owner;
alter function public.list_neon_import_history(text) owner to hotel_ld_migration_owner;

revoke all on function app_private.assert_neon_import_manager(text) from public;
revoke all on function app_private.neon_import_saga_state(uuid) from public;
revoke all on function app_private.append_neon_import_activity(uuid,text,public.import_storage_lifecycle,public.import_workbook_lifecycle,jsonb) from public;

revoke all on function public.create_neon_import_upload_intent(text,uuid,text,text,text,bigint,text,text) from public;
revoke all on function public.create_neon_import_upload_intent(text,uuid,text,text,text,bigint,text,text) from hotel_ld_application;
grant execute on function public.create_neon_import_upload_intent(text,uuid,text,text,text,bigint,text,text) to hotel_ld_application;
revoke all on function public.record_neon_import_object_uploaded(text,uuid,bigint) from public;
revoke all on function public.record_neon_import_object_uploaded(text,uuid,bigint) from hotel_ld_application;
grant execute on function public.record_neon_import_object_uploaded(text,uuid,bigint) to hotel_ld_application;
revoke all on function public.record_neon_import_object_verification(text,uuid,bigint,text,bigint,text,text,text) from public;
revoke all on function public.record_neon_import_object_verification(text,uuid,bigint,text,bigint,text,text,text) from hotel_ld_application;
grant execute on function public.record_neon_import_object_verification(text,uuid,bigint,text,bigint,text,text,text) to hotel_ld_application;
revoke all on function public.mark_neon_import_cleanup_pending(text,uuid,bigint,text) from public;
revoke all on function public.mark_neon_import_cleanup_pending(text,uuid,bigint,text) from hotel_ld_application;
grant execute on function public.mark_neon_import_cleanup_pending(text,uuid,bigint,text) to hotel_ld_application;
revoke all on function public.claim_neon_import_cleanup(text,uuid,integer,uuid) from public;
revoke all on function public.claim_neon_import_cleanup(text,uuid,integer,uuid) from hotel_ld_application;
grant execute on function public.claim_neon_import_cleanup(text,uuid,integer,uuid) to hotel_ld_application;
revoke all on function public.complete_neon_import_cleanup(text,uuid,uuid,uuid) from public;
revoke all on function public.complete_neon_import_cleanup(text,uuid,uuid,uuid) from hotel_ld_application;
grant execute on function public.complete_neon_import_cleanup(text,uuid,uuid,uuid) to hotel_ld_application;
revoke all on function public.fail_neon_import_cleanup(text,uuid,uuid,uuid,text,timestamptz) from public;
revoke all on function public.fail_neon_import_cleanup(text,uuid,uuid,uuid,text,timestamptz) from hotel_ld_application;
grant execute on function public.fail_neon_import_cleanup(text,uuid,uuid,uuid,text,timestamptz) to hotel_ld_application;
revoke all on function public.get_neon_import_workflow(text,uuid) from public;
revoke all on function public.get_neon_import_workflow(text,uuid) from hotel_ld_application;
grant execute on function public.get_neon_import_workflow(text,uuid) to hotel_ld_application;
revoke all on function public.list_neon_import_history(text) from public;
revoke all on function public.list_neon_import_history(text) from hotel_ld_application;
grant execute on function public.list_neon_import_history(text) to hotel_ld_application;

set local check_function_bodies = on;
commit;
