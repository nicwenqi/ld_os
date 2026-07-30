begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- C5 deliberately reuses the reviewed D1/D2 aggregate. This focused gate
-- verifies the controlled chain and its fact boundary without creating any
-- hotel data: the rollback-bound D2 test exercises the corresponding
-- synthetic manager/department lifecycle end to end.
select has_table('public', 'training_plans', 'C5 reuses stable Training Plan identities');
select has_table('public', 'training_plan_versions', 'C5 reuses immutable Plan Versions');
select has_table('public', 'training_plan_items', 'C5 reuses immutable Plan Items');
select has_table('public', 'training_sessions', 'C5 reuses stable Session identities');
select has_table('public', 'training_session_revisions', 'C5 reuses immutable Session Revisions');
select has_table('public', 'session_participant_snapshots', 'C5 freezes publication-time Participant Snapshots');
select has_table('public', 'attendance_preparation_configs', 'C5 stops at attendance preparation configuration');

select has_function(
  'public', 'save_training_plan_version_draft', array['uuid', 'jsonb', 'bigint'],
  'C5 creates Plan drafts only through the guarded manager RPC'
);
select has_function(
  'public', 'transition_training_plan_version', array['uuid', 'text', 'bigint', 'text'],
  'C5 transitions Plan Versions through an audited lifecycle RPC'
);
select has_function(
  'public', 'save_training_session_revision_draft', array['uuid', 'jsonb', 'bigint'],
  'C5 creates Session drafts only through the guarded manager RPC'
);
select has_function(
  'public', 'save_department_training_session_revision_draft', array['jsonb', 'bigint'],
  'C5 derives Department Training Responsible Person property and scope server-side'
);
select has_function(
  'public', 'preview_training_session_participants', array['uuid', 'jsonb'],
  'C5 Participant Snapshot preview is explicitly zero-write'
);
select has_function(
  'public', 'preview_department_training_session_participants', array['uuid'],
  'C5 Department preview accepts no browser-selected property or scope'
);
select has_function(
  'public', 'publish_training_session_revision', array['uuid', 'bigint'],
  'C5 publishes a prepared Session Revision through one controlled transition'
);

select results_eq(
  $$select count(*)
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name in (
        'training_plans', 'training_plan_versions', 'training_plan_items',
        'training_sessions', 'training_session_revisions',
        'session_participant_snapshots', 'attendance_preparation_configs'
      )
      and privilege_type in ('insert', 'update', 'delete')$$,
  array[0::bigint],
  'C5 exposes no direct browser write path for Plan, Session or Participant Snapshot facts'
);

select results_eq(
  $$select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'training_plans', 'training_plan_versions', 'training_plan_items',
        'training_sessions', 'training_session_revisions',
        'session_participant_snapshots', 'attendance_preparation_configs'
      )
      and relation.relrowsecurity
      and relation.relforcerowsecurity$$,
  array[7::bigint],
  'C5 facts preserve forced RLS at every exposed relation'
);

select ok(
  position('attendance_records' in pg_get_functiondef(
    'public.publish_training_session_revision(uuid,bigint)'::regprocedure
  )) = 0,
  'publishing preparation does not create or modify Attendance facts'
);
select ok(
  position('completion_records' in pg_get_functiondef(
    'public.publish_training_session_revision(uuid,bigint)'::regprocedure
  )) = 0,
  'publishing preparation does not create or modify Completion facts'
);
select ok(
  position('attendance_determinations' in pg_get_functiondef(
    'public.publish_training_session_revision(uuid,bigint)'::regprocedure
  )) = 0,
  'publishing preparation does not create Attendance Determinations'
);

select results_eq(
  $$select count(*)
    from pg_trigger trigger_row
    join pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('training_plan_versions', 'training_session_revisions')
      and not trigger_row.tgisinternal$$,
  array[3::bigint],
  'C5 retains immutable published Plan and Session Version protection triggers'
);

select * from finish();
rollback;
