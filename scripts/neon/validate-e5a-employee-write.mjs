import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";

const CHILD_BRANCH = "br-aged-river-az1gke14";
const CHILD_ENDPOINT = "ep-sparkling-shape-az9gxtuh";
const PRODUCTION_BRANCH = "br-twilight-leaf-azmowo1k";
const PRODUCTION_ENDPOINT = "ep-wild-wave-azjmgdif";
const DATABASE = "neondb";
const BOOTSTRAP_ROLE = "neondb_owner";
const RUNTIME_ROLE = "hotel_ld_application";
const BASE_MIGRATION = new URL(
  "../../neon/migrations/202608070015_e5a_employee_write.sql",
  import.meta.url,
);
const HARDENING_MIGRATION = new URL(
  "../../neon/migrations/202608070016_e5a_employee_write_hardening.sql",
  import.meta.url,
);
const ENTRYPOINT =
  "public.save_neon_employee_with_identifiers(text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text,date,date,text,boolean,jsonb)";

export function assertConnectionTarget(raw, kind) {
  if (kind !== "bootstrap" && kind !== "runtime") {
    throw new Error("E5A_EMPLOYEE_WRITE_CONNECTION_KIND_INVALID");
  }
  return approved(
    raw,
    kind === "bootstrap" ? BOOTSTRAP_ROLE : RUNTIME_ROLE,
    kind === "runtime",
    kind,
  );
}

export function assertApprovedBootstrapUrl(raw) {
  return assertConnectionTarget(raw, "bootstrap");
}

export function assertApprovedRuntimeUrl(raw) {
  return assertConnectionTarget(raw, "runtime");
}

async function main() {
  const command = process.argv[2];
  if (!new Set(["source", "dry-run", "apply", "catalog", "runtime"]).has(command)) {
    throw new Error("E5A_EMPLOYEE_WRITE_COMMAND_REQUIRED");
  }
  if (command === "source") return output(command, await sourceCheck());

  const values = await environmentValues();
  if (command === "runtime") {
    const raw = required(values, "DATABASE_URL");
    return output(command, await runtime(raw));
  }

  const raw = required(values, "NEON_BOOTSTRAP_DATABASE_URL");
  if (command === "catalog") return output(command, await catalog(raw));
  return output(command, await migrate(raw, command === "dry-run"));
}

async function sourceCheck() {
  const [base, hardening] = await Promise.all([
    readFile(BASE_MIGRATION, "utf8"),
    readFile(HARDENING_MIGRATION, "utf8"),
  ]);
  const source = `${base}\n${hardening}`;
  const fragments = [
    "save_neon_employee_with_identifiers",
    "employee_write_audit_events",
    "security definer",
    "set search_path = ''",
    "force row level security",
    "for update",
    "expected_version",
    "jsonb_to_recordset",
    "revoke all on function",
    "to hotel_ld_application",
    "employees_record_fact_version",
  ];
  const entrypoint = hardening.match(
    /create or replace function public\.save_neon_employee_with_identifiers[\s\S]*?\n\$function\$;/i,
  )?.[0] ?? "";
  if (
    !fragments.every(fragment => source.toLowerCase().includes(fragment.toLowerCase()))
    || !/begin;[\s\S]*commit;\s*$/.test(base)
    || !/begin;[\s\S]*commit;\s*$/.test(hardening)
    || !entrypoint
    || /is_new_employee/i.test(entrypoint)
    || /drop\s+trigger[\s\S]*employees_record_fact_version/i.test(source)
  ) {
    throw new Error("E5A_EMPLOYEE_WRITE_SOURCE_CONTRACT_MISSING");
  }
  return {
    transaction: true,
    singleMutationEntrypoint: true,
    identifiersAtomicReplacement: true,
    newEmployeeRuleExcluded: true,
    existingEmployeeFactsBoundaryPreserved: true,
    correctiveHardening: true,
  };
}

async function migrate(raw, rollback) {
  const connection = assertApprovedBootstrapUrl(raw);
  const [base, hardening] = await Promise.all([
    readFile(BASE_MIGRATION, "utf8"),
    readFile(HARDENING_MIGRATION, "utf8"),
  ]);
  const client = new pg.Client({ connectionString: raw });
  await client.connect();
  try {
    await assertIdentity(
      client,
      BOOTSTRAP_ROLE,
      "E5A_EMPLOYEE_WRITE_BOOTSTRAP_IDENTITY_MISMATCH",
    );
    try {
      if (rollback) {
        await freshInstallDryRun(client, base, hardening);
      } else {
        await client.query(hardening);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "migration failed";
      const position = error && typeof error === "object" && "position" in error
        ? error.position
        : null;
      throw new Error(`${message}${position ? ` (position ${position})` : ""}`);
    }
    return { connection, applied: !rollback, rolledBack: rollback };
  } finally {
    await client.end();
  }
}

async function freshInstallDryRun(client, base, hardening) {
  await client.query("begin");
  try {
    await client.query(`
      drop function if exists public.save_neon_employee_with_identifiers(
        text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,
        text,date,date,text,boolean,jsonb
      );
      drop table if exists app_private.employee_write_audit_events cascade;
      drop function if exists app_private.neon_employee_authoritative_snapshot(uuid);
      drop function if exists app_private.neon_employee_authoritative_snapshot(
        public.employees,jsonb
      );
      drop function if exists app_private.neon_employee_identifier_snapshot(uuid);
      drop function if exists app_private.append_neon_employee_write_audit(
        uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb
      );
      drop function if exists app_private.append_neon_employee_write_audit(
        public.employees,text,bigint,jsonb,jsonb
      );
      drop function if exists app_private.reject_employee_write_audit_mutation();
      drop policy if exists e5a_employees_insert on public.employees;
      drop policy if exists e5a_employees_update on public.employees;
      drop policy if exists e5a_employee_identifiers_insert
        on public.employee_external_identifiers;
      drop policy if exists e5a_employee_identifiers_delete
        on public.employee_external_identifiers;
    `);
    await client.query(transactionBody(base));
    await client.query(transactionBody(hardening));
  } finally {
    await client.query("rollback");
  }
}

function transactionBody(source) {
  const withoutBegin = source.replace(/\nbegin;\s*/i, "\n");
  return withoutBegin.replace(/\ncommit;\s*$/i, "\n");
}

async function catalog(raw) {
  const connection = assertApprovedBootstrapUrl(raw);
  const client = new pg.Client({ connectionString: raw });
  await client.connect();
  try {
    await client.query("begin read only");
    await assertIdentity(
      client,
      BOOTSTRAP_ROLE,
      "E5A_EMPLOYEE_WRITE_BOOTSTRAP_IDENTITY_MISMATCH",
    );
    const result = await client.query(`
      select
        exists (
          select 1
          from pg_catalog.pg_proc routine
          join pg_catalog.pg_roles owner_role on owner_role.oid = routine.proowner
          where routine.oid = pg_catalog.to_regprocedure($1)
            and owner_role.rolname = 'hotel_ld_migration_owner'
            and routine.prosecdef
            and routine.proconfig = array['search_path=""']::text[]
            and not pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
            and pg_catalog.has_function_privilege('hotel_ld_application', routine.oid, 'EXECUTE')
        ) as entrypoint_ok,
        exists (
          select 1
          from pg_catalog.pg_trigger trigger_record
          where trigger_record.tgrelid = 'public.employees'::regclass
            and trigger_record.tgname = 'employees_record_fact_version'
            and not trigger_record.tgisinternal
            and trigger_record.tgenabled <> 'D'
            and trigger_record.tgfoid = pg_catalog.to_regprocedure(
              'app_private.record_employee_fact_version()'
            )
        ) as facts_trigger_preserved,
        exists (
          select 1
          from pg_catalog.pg_trigger trigger_record
          where trigger_record.tgrelid = 'app_private.employee_write_audit_events'::regclass
            and trigger_record.tgname = 'e5a_employee_write_audit_append_only'
            and not trigger_record.tgisinternal
            and trigger_record.tgenabled <> 'D'
            and trigger_record.tgfoid = pg_catalog.to_regprocedure(
              'app_private.reject_employee_write_audit_mutation()'
            )
        ) as audit_append_only,
        not exists (
          select 1
          from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'app_private.employee_write_audit_events'::regclass
            and not attribute.attisdropped
            and attribute.attname = 'is_new_employee'
        ) as audit_excludes_new_employee,
        not exists (
          select 1
          from pg_catalog.unnest(array[
            'public.employees',
            'public.employee_external_identifiers',
            'app_private.employee_write_audit_events'
          ]) relation(value)
          where pg_catalog.has_table_privilege(
            'hotel_ld_application', relation.value,
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          )
        ) as no_raw,
        not exists (
          select 1
          from pg_catalog.unnest(array[
            'public.employees',
            'public.employee_external_identifiers',
            'app_private.employee_write_audit_events'
          ]) relation(value)
          join pg_catalog.pg_class class_record
            on class_record.oid = relation.value::regclass
          join pg_catalog.pg_roles owner_role
            on owner_role.oid = class_record.relowner
          where owner_role.rolname = 'hotel_ld_application'
        ) as runtime_owns_nothing,
        (
          select not role_record.rolbypassrls and not role_record.rolsuper
          from pg_catalog.pg_roles role_record
          where role_record.rolname = 'hotel_ld_application'
        ) as runtime_restricted,
        not pg_catalog.has_column_privilege(
          'hotel_ld_migration_owner', 'public.employees',
          'is_new_employee', 'UPDATE'
        ) and not pg_catalog.has_column_privilege(
          'hotel_ld_migration_owner', 'public.employees',
          'source_batch_id', 'SELECT'
        ) and not pg_catalog.has_column_privilege(
          'hotel_ld_migration_owner', 'public.employee_external_identifiers',
          'source_batch_id', 'SELECT'
        ) as grants_narrowed,
        not exists (
          select 1
          from pg_catalog.unnest(array[
            'public.employees',
            'public.employee_external_identifiers',
            'app_private.employee_write_audit_events'
          ]) relation(value)
          join pg_catalog.pg_class class_record
            on class_record.oid = relation.value::regclass
          where not class_record.relrowsecurity
             or not class_record.relforcerowsecurity
        ) as force_rls
    `, [ENTRYPOINT]);
    const row = result.rows[0];
    if (
      !row?.entrypoint_ok
      || !row.facts_trigger_preserved
      || !row.audit_append_only
      || !row.audit_excludes_new_employee
      || !row.no_raw
      || !row.runtime_owns_nothing
      || !row.runtime_restricted
      || !row.grants_narrowed
      || !row.force_rls
    ) {
      throw new Error("E5A_EMPLOYEE_WRITE_CATALOG_DRIFT");
    }
    return {
      connection,
      constrainedEntrypoint: true,
      forceRls: true,
      noRawApplicationPrivilege: true,
      applicationOwnsNothing: true,
      appendOnlyAudit: true,
      newEmployeeRuleExcluded: true,
      existingEmployeeFactsBoundaryPreserved: true,
      migrationOwnerGrantsNarrowed: true,
    };
  } finally {
    try { await client.query("rollback"); }
    finally { await client.end(); }
  }
}

async function runtime(raw) {
  const connection = assertApprovedRuntimeUrl(raw);
  const client = new pg.Client({ connectionString: raw });
  await client.connect();
  try {
    await assertIdentity(
      client,
      RUNTIME_ROLE,
      "E5A_EMPLOYEE_WRITE_RUNTIME_IDENTITY_MISMATCH",
    );
    await client.query("begin");
    const assertions = {
      connection,
      rawEmployeeDenied: await denied(
        client, "employee", "select 1 from public.employees limit 1",
      ),
      rawIdentifierDenied: await denied(
        client, "identifier", "select 1 from public.employee_external_identifiers limit 1",
      ),
      rawAuditDenied: await denied(
        client, "audit", "select 1 from app_private.employee_write_audit_events limit 1",
      ),
      noActorEntrypointDenied: await denied(
        client,
        "no_actor",
        `select public.save_neon_employee_with_identifiers(
          'example.invalid',
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
          null,0,'E-1','Employee',null,null,null,null,null,null,null,null,
          'inactive',false,'[]'::jsonb
        )`,
        { code: "42501", message: "ACTOR_CONTEXT_REQUIRED" },
      ),
    };
    await client.query("rollback");

    await client.query("begin");
    await client.query(
      "select pg_catalog.set_config('app.actor_auth_user_id','11111111-1111-4111-8111-111111111111',true)",
    );
    await client.query("rollback");
    const clean = (await client.query(`
      select
        nullif(pg_catalog.current_setting('app.actor_auth_user_id', true), '') is null
        and nullif(pg_catalog.current_setting('app.actor_property_id', true), '') is null
        and nullif(pg_catalog.current_setting('app.actor_request_id', true), '') is null
        as clean
    `)).rows[0]?.clean;
    if (!clean) throw new Error("E5A_EMPLOYEE_WRITE_ACTOR_CONTEXT_LEAK");

    return {
      ...assertions,
      actorContextCleanup: true,
      connectionReuseClean: true,
      identityMatrix:
        "deferred: requires configured non-production manager and department-admin identities",
    };
  } finally {
    try { await client.query("rollback"); }
    finally { await client.end(); }
  }
}

async function denied(client, name, sql, expected) {
  await client.query(`savepoint ${name}`);
  try {
    await client.query(sql);
  } catch (error) {
    await client.query(`rollback to savepoint ${name}`);
    if (
      expected
      && (
        !error
        || typeof error !== "object"
        || error.code !== expected.code
        || error.message !== expected.message
      )
    ) {
      throw new Error("E5A_EMPLOYEE_WRITE_UNEXPECTED_DENIAL");
    }
    return true;
  }
  throw new Error("E5A_EMPLOYEE_WRITE_EXPECTED_DENIAL_MISSING");
}

function approved(raw, role, pooled, kind) {
  if (
    typeof raw !== "string"
    || raw.includes(PRODUCTION_BRANCH)
    || raw.includes(PRODUCTION_ENDPOINT)
  ) {
    throw new Error("E5A_EMPLOYEE_WRITE_PRODUCTION_DENIED");
  }
  let url;
  try { url = new URL(raw); }
  catch { throw new Error("E5A_EMPLOYEE_WRITE_URL_INVALID"); }

  const host = url.hostname.toLowerCase();
  const labels = host.split(".");
  const neonDomain = host.endsWith(".neon.tech") && labels.length >= 3;
  const direct = neonDomain && labels[0] === CHILD_ENDPOINT;
  const pooler = neonDomain && labels[0] === `${CHILD_ENDPOINT}-pooler`;
  if (!direct && !pooler) {
    throw new Error("E5A_EMPLOYEE_WRITE_CHILD_ENDPOINT_REQUIRED");
  }
  if (url.pathname.replace(/^\//, "") !== DATABASE) {
    throw new Error("E5A_EMPLOYEE_WRITE_DATABASE_DENIED");
  }
  if (decodeURIComponent(url.username) !== role) {
    throw new Error(`E5A_EMPLOYEE_WRITE_${role.toUpperCase()}_REQUIRED`);
  }
  if (pooler !== pooled) {
    throw new Error(
      pooled
        ? "E5A_EMPLOYEE_WRITE_POOLED_RUNTIME_REQUIRED"
        : "E5A_EMPLOYEE_WRITE_DIRECT_BOOTSTRAP_REQUIRED",
    );
  }
  return {
    branch: CHILD_BRANCH,
    endpoint: CHILD_ENDPOINT,
    database: DATABASE,
    role,
    pooled,
    kind,
  };
}

async function assertIdentity(client, role, message) {
  const row = (await client.query(
    "select current_database() as database,current_user,session_user",
  )).rows[0];
  if (
    row?.database !== DATABASE
    || row.current_user !== role
    || row.session_user !== role
  ) throw new Error(message);
}

async function environmentValues() {
  let source;
  try {
    source = await readFile(
      process.env.E5A_EMPLOYEE_WRITE_ENV_FILE ?? ".env.local",
      "utf8",
    );
  } catch {
    throw new Error("E5A_EMPLOYEE_WRITE_ENVIRONMENT_MISSING");
  }
  return Object.fromEntries(
    source.split(/\r?\n/)
      .map(line => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, "")]),
  );
}

function required(values, key) {
  const value = values[key]?.trim();
  if (!value) throw new Error(`E5A_EMPLOYEE_WRITE_${key}_REQUIRED`);
  return value;
}

function output(command, assertions) {
  console.log(JSON.stringify({
    command,
    child: { branch: CHILD_BRANCH, endpoint: CHILD_ENDPOINT },
    assertions,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "E5A_EMPLOYEE_WRITE_UNKNOWN");
    process.exitCode = 1;
  });
}
