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
  "../../neon/migrations/202608060011_e4_position_readonly.sql",
  import.meta.url,
);

export function assertApprovedBootstrapUrl(raw) {
  return approvedUrl(raw, BOOTSTRAP_ROLE, false, "E4_POSITION_BOOTSTRAP_ROLE_DENIED");
}

export function assertApprovedRuntimeUrl(raw) {
  return approvedUrl(raw, RUNTIME_ROLE, true, "E4_POSITION_RUNTIME_ROLE_DENIED");
}

async function main() {
  const command = process.argv[2];
  if (!new Set(["source", "dry-run", "apply", "catalog", "runtime"]).has(command)) {
    throw new Error("E4_POSITION_VALIDATION_COMMAND_REQUIRED");
  }
  if (command === "source") {
    console.log(JSON.stringify({ command, assertions: await sourceCheck() }));
    return;
  }

  const environment = await environmentValues();
  if (command === "runtime") {
    const url = required(environment, "DATABASE_URL");
    console.log(JSON.stringify({
      command,
      runtime: assertApprovedRuntimeUrl(url),
      assertions: await runtimeCheck(url),
    }));
    return;
  }

  const url = required(environment, "NEON_BOOTSTRAP_DATABASE_URL");
  const bootstrap = assertApprovedBootstrapUrl(url);
  const assertions = command === "catalog"
    ? await catalogCheck(url)
    : await migrate(url, command === "dry-run");
  console.log(JSON.stringify({ command, bootstrap, assertions }));
}

async function sourceCheck() {
  const source = await readFile(MIGRATION, "utf8");
  const fragments = [
    "read_neon_position_families",
    "read_neon_positions",
    "position_read_audit_events",
    "security definer",
    "set search_path = ''",
    "revoke all on function",
    "to hotel_ld_application",
    "neon_position_actor_can_read_position",
    "department_ids",
  ];
  if (!fragments.every(fragment => source.toLowerCase().includes(fragment.toLowerCase())) ||
      !/begin;[\s\S]*commit;\s*$/.test(source)) {
    throw new Error("E4_POSITION_SOURCE_CONTRACT_MISSING");
  }
  return { migrationTransaction: true, constrainedEntrypoints: 2, scopedProjection: true };
}

async function migrate(connectionString, rollback) {
  const source = await readFile(MIGRATION, "utf8");
  const statement = rollback ? source.replace(/\ncommit;\s*$/, "\nrollback;\n") : source;
  if (!statement.includes(rollback ? "\nrollback;\n" : "\ncommit;")) {
    throw new Error("E4_POSITION_MIGRATION_TRANSACTION_MISSING");
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await assertIdentity(client, BOOTSTRAP_ROLE, "E4_POSITION_BOOTSTRAP_IDENTITY_MISMATCH");
    await client.query(statement);
    return { applied: !rollback, rolledBack: rollback };
  } finally { await client.end(); }
}

async function catalogCheck(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin read only");
    await assertIdentity(client, BOOTSTRAP_ROLE, "E4_POSITION_BOOTSTRAP_IDENTITY_MISMATCH");
    const row = (await client.query(`
      select
        (
          select count(*) = 2 from pg_catalog.pg_proc routine
          join pg_catalog.pg_roles owner_role on owner_role.oid = routine.proowner
          where routine.oid = any (array[
            pg_catalog.to_regprocedure('public.read_neon_position_families(text)'),
            pg_catalog.to_regprocedure('public.read_neon_positions(text)')
          ]::regprocedure[])
            and owner_role.rolname = 'hotel_ld_migration_owner'
            and routine.prosecdef
            and routine.proconfig = array['search_path=""']::text[]
            and not pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
            and pg_catalog.has_function_privilege('hotel_ld_application', routine.oid, 'EXECUTE')
        ) as entrypoints_ok,
        (
          select relrowsecurity and relforcerowsecurity
          from pg_catalog.pg_class
          where oid = 'app_private.position_read_audit_events'::regclass
        ) as audit_rls_forced,
        not exists (
          select 1 from pg_catalog.unnest(array[
            'public.position_families', 'public.positions',
            'public.position_department_assignments',
            'app_private.position_read_audit_events'
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
    `)).rows[0];
    if (!row?.entrypoints_ok || !row.audit_rls_forced || !row.no_raw || !row.runtime_restricted) {
      throw new Error("E4_POSITION_CATALOG_DRIFT");
    }
    return {
      constrainedEntrypoints: 2, forcedAuditRls: true,
      noRawPositionPrivileges: true, runtimeRestricted: true,
    };
  } finally {
    try { await client.query("rollback"); } finally { await client.end(); }
  }
}

async function runtimeCheck(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await assertIdentity(client, RUNTIME_ROLE, "E4_POSITION_RUNTIME_IDENTITY_MISMATCH");
    await client.query("begin read only");
    const topology = (await client.query(`
      select
        (select not rolbypassrls and not rolsuper from pg_catalog.pg_roles where rolname=current_user) as restricted,
        not pg_catalog.has_table_privilege(current_user,'public.position_families','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as no_raw_families,
        not pg_catalog.has_table_privilege(current_user,'public.positions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as no_raw_positions,
        not pg_catalog.has_table_privilege(current_user,'public.position_department_assignments','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as no_raw_assignments,
        not pg_catalog.has_schema_privilege(current_user,'app_private','USAGE') as audit_acl,
        pg_catalog.has_function_privilege(current_user,'public.read_neon_position_families(text)','EXECUTE') as family_execute,
        pg_catalog.has_function_privilege(current_user,'public.read_neon_positions(text)','EXECUTE') as position_execute
    `)).rows[0];
    if (!topology?.restricted || !topology.no_raw_families || !topology.no_raw_positions ||
        !topology.no_raw_assignments || !topology.audit_acl || !topology.family_execute ||
        !topology.position_execute) throw new Error("E4_POSITION_RUNTIME_TOPOLOGY_DRIFT");

    const assertions = {
      restrictedRole: true,
      rawPositionReadsDenied: await denied(client, "raw_positions", "select 1 from public.positions limit 1"),
      rawPositionWritesDenied: await denied(client, "raw_position_write", "update public.positions set is_active=is_active where false"),
      rawAssignmentReadsDenied: await denied(client, "raw_assignments", "select 1 from public.position_department_assignments limit 1"),
      auditAclDenied: await denied(client, "audit_acl", "select 1 from app_private.position_read_audit_events limit 1"),
      noActorEntrypointDenied: await denied(client, "without_actor", "select public.read_neon_positions('example.invalid')"),
    };
    await client.query("rollback");
    await client.query("begin");
    await client.query("select pg_catalog.set_config('app.actor_auth_user_id','11111111-1111-4111-8111-111111111111',true)");
    await client.query("rollback");
    const clean = (await client.query(`select nullif(pg_catalog.current_setting('app.actor_auth_user_id', true),'') is null as clean`)).rows[0]?.clean;
    if (!clean) throw new Error("E4_POSITION_ACTOR_CONTEXT_LEAK");
    assertions.actorContextCleanup = true;
    assertions.connectionReuseClean = true;
    assertions.identityMatrix = "deferred: requires configured non-production manager and department-admin identities";
    return assertions;
  } finally {
    try { await client.query("rollback"); } finally { await client.end(); }
  }
}

async function denied(client, name, statement) {
  await client.query(`savepoint ${name}`);
  try { await client.query(statement); } catch {
    await client.query(`rollback to savepoint ${name}`);
    return true;
  }
  throw new Error("E4_POSITION_EXPECTED_DENIAL_MISSING");
}

async function assertIdentity(client, role, message) {
  const row = (await client.query("select current_database() as database,current_user,session_user")).rows[0];
  if (row?.database !== DATABASE || row.current_user !== role || row.session_user !== role) throw new Error(message);
}

function approvedUrl(raw, role, pooled, roleError) {
  if (typeof raw !== "string" || raw.includes(PRODUCTION_BRANCH) || raw.includes(PRODUCTION_ENDPOINT)) {
    throw new Error("E4_POSITION_PRODUCTION_DENIED");
  }
  let url;
  try { url = new URL(raw); } catch { throw new Error("E4_POSITION_DATABASE_URL_INVALID"); }
  const hostname = url.hostname.toLowerCase();
  const developmentHost = hostname.startsWith(`${DEVELOPMENT_ENDPOINT}.`) || hostname.startsWith(`${DEVELOPMENT_ENDPOINT}-pooler.`);
  if (!developmentHost) throw new Error("E4_POSITION_CHILD_ENDPOINT_REQUIRED");
  if (url.pathname.replace(/^\//, "") !== DATABASE) throw new Error("E4_POSITION_DATABASE_DENIED");
  if (decodeURIComponent(url.username) !== role) throw new Error(roleError);
  const actualPooled = hostname.startsWith(`${DEVELOPMENT_ENDPOINT}-pooler.`);
  if (actualPooled !== pooled) throw new Error(pooled ? "E4_POSITION_POOLED_RUNTIME_REQUIRED" : "E4_POSITION_DIRECT_BOOTSTRAP_REQUIRED");
  return { branch: DEVELOPMENT_BRANCH, endpoint: DEVELOPMENT_ENDPOINT, database: DATABASE, role, pooled };
}

async function environmentValues() {
  const path = process.env.E4_POSITION_ENV_FILE ?? ".env.local";
  let source;
  try { source = await readFile(path, "utf8"); } catch { throw new Error("E4_POSITION_ENVIRONMENT_MISSING"); }
  return Object.fromEntries(source.split(/\r?\n/)
    .map(line => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, "")]));
}

function required(values, key) {
  const value = values[key]?.trim();
  if (!value) throw new Error(`E4_POSITION_${key}_REQUIRED`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "E4_POSITION_UNKNOWN_ERROR");
    process.exitCode = 1;
  });
}
