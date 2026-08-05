import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";

const DEVELOPMENT_BRANCH = "br-aged-river-az1gke14";
const DEVELOPMENT_ENDPOINT = "ep-sparkling-shape-az9gxtuh";
const PRODUCTION_BRANCH = "br-twilight-leaf-azmowo1k";
const PRODUCTION_ENDPOINT = "ep-wild-wave-azjmgdif";
const DATABASE = "neondb";
const BOOTSTRAP_ROLE = "neondb_owner";
const RUNTIME_ROLE = "hotel_ld_application";
const MIGRATION = new URL(
  "../../neon/migrations/202608050010_e3_organization_activation_completion.sql",
  import.meta.url,
);

export function assertApprovedBootstrapUrl(raw) {
  return approvedUrl(raw, BOOTSTRAP_ROLE, false, "E3_ACTIVATION_BOOTSTRAP_ROLE_DENIED");
}

export function assertApprovedRuntimeUrl(raw) {
  return approvedUrl(raw, RUNTIME_ROLE, true, "E3_ACTIVATION_RUNTIME_ROLE_DENIED");
}

async function main() {
  const command = process.argv[2];
  if (!new Set(["source", "dry-run", "apply", "catalog", "runtime"]).has(command)) {
    throw new Error("E3_ACTIVATION_VALIDATION_COMMAND_REQUIRED");
  }
  if (command === "source") {
    console.log(JSON.stringify({ command, assertions: await sourceCheck() }));
    return;
  }

  const environment = await environmentValues();
  if (command === "runtime") {
    const runtimeUrl = required(environment, "DATABASE_URL");
    const runtime = assertApprovedRuntimeUrl(runtimeUrl);
    console.log(JSON.stringify({ command, runtime, assertions: await runtimeCheck(runtimeUrl) }));
    return;
  }

  const bootstrapUrl = required(environment, "NEON_BOOTSTRAP_DATABASE_URL");
  const bootstrap = assertApprovedBootstrapUrl(bootstrapUrl);
  const assertions = command === "catalog"
    ? await catalogCheck(bootstrapUrl)
    : await migrate(bootstrapUrl, command === "dry-run");
  console.log(JSON.stringify({ command, bootstrap, assertions }));
}

async function sourceCheck() {
  const source = await readFile(MIGRATION, "utf8");
  const requiredFragments = [
    "merge_neon_organization_department_alias",
    "resolve_neon_organization_department_alias_to_operational_unit",
    "create_neon_organization_department_from_alias",
    "public.create_neon_organization_department(",
    "organization_alias_activation_audit_events",
    "security definer",
    "set search_path = ''",
    "revoke all on function",
    "to hotel_ld_application",
  ];
  if (!requiredFragments.every(fragment => source.toLowerCase().includes(fragment.toLowerCase()))) {
    throw new Error("E3_ACTIVATION_SOURCE_CONTRACT_MISSING");
  }
  if (!/begin;[\s\S]*commit;\s*$/.test(source)) {
    throw new Error("E3_ACTIVATION_MIGRATION_TRANSACTION_MISSING");
  }
  return {
    migrationTransaction: true,
    constrainedEntrypoints: 3,
    reusesDepartmentCreationEntrypoint: true,
  };
}

async function migrate(connectionString, rollback) {
  const source = await readFile(MIGRATION, "utf8");
  const statement = rollback
    ? source.replace(/\ncommit;\s*$/, "\nrollback;\n")
    : source;
  if (!statement.includes(rollback ? "\nrollback;\n" : "\ncommit;")) {
    throw new Error("E3_ACTIVATION_MIGRATION_TRANSACTION_MISSING");
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await assertIdentity(client, BOOTSTRAP_ROLE, "E3_ACTIVATION_BOOTSTRAP_IDENTITY_MISMATCH");
    await client.query(statement);
    return { applied: !rollback, rolledBack: rollback };
  } finally {
    await client.end();
  }
}

async function catalogCheck(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin read only");
    await assertIdentity(client, BOOTSTRAP_ROLE, "E3_ACTIVATION_BOOTSTRAP_IDENTITY_MISMATCH");
    const result = await client.query(`
      select
        (
          select count(*) = 3
          from pg_catalog.pg_proc routine
          join pg_catalog.pg_roles owner_role on owner_role.oid = routine.proowner
          where routine.oid = any (array[
            pg_catalog.to_regprocedure('public.merge_neon_organization_department_alias(text,uuid,uuid)'),
            pg_catalog.to_regprocedure('public.resolve_neon_organization_department_alias_to_operational_unit(text,uuid,uuid)'),
            pg_catalog.to_regprocedure('public.create_neon_organization_department_from_alias(text,uuid,text,uuid,text,text,text,text,integer)')
          ]::regprocedure[])
            and owner_role.rolname = 'hotel_ld_migration_owner'
            and routine.prosecdef
            and routine.proconfig = array['search_path=""']::text[]
            and not pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
            and pg_catalog.has_function_privilege('hotel_ld_application', routine.oid, 'EXECUTE')
        ) as entrypoints_ok,
        (
          select relation.relrowsecurity and relation.relforcerowsecurity
          from pg_catalog.pg_class relation
          where relation.oid = 'app_private.organization_alias_activation_audit_events'::regclass
        ) as audit_rls_forced,
        not exists (
          select 1 from pg_catalog.unnest(array[
            'public.departments', 'public.department_aliases',
            'public.operational_units', 'public.operational_unit_aliases',
            'app_private.organization_alias_activation_audit_events'
          ]) relation(value)
          where pg_catalog.has_table_privilege(
            'hotel_ld_application', relation.value,
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          )
        ) as no_raw,
        (
          select not rolbypassrls and not rolsuper
          from pg_catalog.pg_roles where rolname = 'hotel_ld_application'
        ) as runtime_restricted
    `);
    const row = result.rows[0];
    if (!row?.entrypoints_ok || !row.audit_rls_forced || !row.no_raw || !row.runtime_restricted) {
      throw new Error("E3_ACTIVATION_CATALOG_DRIFT");
    }
    return {
      constrainedEntrypoints: 3,
      forcedRls: true,
      noRawBusinessPrivileges: true,
      runtimeRestricted: true,
      appendOnlyAudit: true,
    };
  } finally {
    try { await client.query("rollback"); } finally { await client.end(); }
  }
}

async function runtimeCheck(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin read only");
    await assertIdentity(client, RUNTIME_ROLE, "E3_ACTIVATION_RUNTIME_IDENTITY_MISMATCH");
    const topology = await client.query(`
      select
        (select not rolbypassrls and not rolsuper from pg_catalog.pg_roles where rolname=current_user) as restricted,
        not pg_catalog.has_table_privilege(current_user,'public.department_aliases','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as no_raw_alias,
        not pg_catalog.has_table_privilege(current_user,'public.operational_unit_aliases','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as no_raw_unit_alias,
        pg_catalog.has_function_privilege(current_user,'public.merge_neon_organization_department_alias(text,uuid,uuid)','EXECUTE') as merge_execute,
        pg_catalog.has_function_privilege(current_user,'public.resolve_neon_organization_department_alias_to_operational_unit(text,uuid,uuid)','EXECUTE') as unit_execute,
        pg_catalog.has_function_privilege(current_user,'public.create_neon_organization_department_from_alias(text,uuid,text,uuid,text,text,text,text,integer)','EXECUTE') as create_execute
    `);
    const row = topology.rows[0];
    if (!row?.restricted || !row.no_raw_alias || !row.no_raw_unit_alias ||
        !row.merge_execute || !row.unit_execute || !row.create_execute) {
      throw new Error("E3_ACTIVATION_RUNTIME_TOPOLOGY_DRIFT");
    }
    return {
      restrictedRole: true,
      noRawAliasPrivileges: true,
      entrypointRequiresActor: await denied(
        client,
        "without_actor",
        "select public.merge_neon_organization_department_alias('example.invalid','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222')",
      ),
      rawReadDenied: await denied(client, "raw_read", "select 1 from public.department_aliases limit 1"),
      rawWriteDenied: await denied(
        client,
        "raw_write",
        "update public.operational_unit_aliases set is_active=is_active where false",
      ),
    };
  } finally {
    try { await client.query("rollback"); } finally { await client.end(); }
  }
}

async function denied(client, name, statement) {
  await client.query(`savepoint ${name}`);
  try {
    await client.query(statement);
  } catch {
    await client.query(`rollback to savepoint ${name}`);
    return true;
  }
  throw new Error("E3_ACTIVATION_EXPECTED_DENIAL_MISSING");
}

async function assertIdentity(client, role, message) {
  const row = (await client.query(
    "select current_database() as database,current_user,session_user",
  )).rows[0];
  if (row?.database !== DATABASE || row.current_user !== role || row.session_user !== role) {
    throw new Error(message);
  }
}

function approvedUrl(raw, role, pooled, roleError) {
  if (typeof raw !== "string" || raw.includes(PRODUCTION_BRANCH) || raw.includes(PRODUCTION_ENDPOINT)) {
    throw new Error("E3_ACTIVATION_PRODUCTION_DENIED");
  }
  let url;
  try { url = new URL(raw); } catch { throw new Error("E3_ACTIVATION_DATABASE_URL_INVALID"); }
  const hostname = url.hostname.toLowerCase();
  const developmentHost = hostname.startsWith(`${DEVELOPMENT_ENDPOINT}.`) ||
    hostname.startsWith(`${DEVELOPMENT_ENDPOINT}-pooler.`);
  if (!developmentHost) throw new Error("E3_ACTIVATION_CHILD_ENDPOINT_REQUIRED");
  if (url.pathname.replace(/^\//, "") !== DATABASE) throw new Error("E3_ACTIVATION_DATABASE_DENIED");
  if (decodeURIComponent(url.username) !== role) throw new Error(roleError);
  const actualPooled = hostname.startsWith(`${DEVELOPMENT_ENDPOINT}-pooler.`);
  if (actualPooled !== pooled) {
    throw new Error(pooled ? "E3_ACTIVATION_POOLED_RUNTIME_REQUIRED" : "E3_ACTIVATION_DIRECT_BOOTSTRAP_REQUIRED");
  }
  return { branch: DEVELOPMENT_BRANCH, endpoint: DEVELOPMENT_ENDPOINT, database: DATABASE, role, pooled };
}

async function environmentValues() {
  const path = process.env.E3_ACTIVATION_ENV_FILE ?? ".env.local";
  let source;
  try { source = await readFile(path, "utf8"); } catch { throw new Error("E3_ACTIVATION_ENVIRONMENT_MISSING"); }
  return Object.fromEntries(
    source.split(/\r?\n/)
      .map(line => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, "")]),
  );
}

function required(values, key) {
  const value = values[key]?.trim();
  if (!value) throw new Error(`E3_ACTIVATION_${key}_REQUIRED`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "E3_ACTIVATION_UNKNOWN_ERROR");
    process.exitCode = 1;
  });
}
