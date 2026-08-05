import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import pg from "pg";

const DEVELOPMENT_ENDPOINT = "ep-sparkling-shape-az9gxtuh";
const PRODUCTION_ENDPOINT = "ep-wild-wave-azjmgdif";
const DATABASE = "neondb";
const BOOTSTRAP_ROLE = "neondb_owner";
const RUNTIME_ROLE = "hotel_ld_application";

export function assertApprovedBootstrapUrl(raw) {
  return approvedConnection(raw, {
    role: BOOTSTRAP_ROLE,
    pooled: false,
    roleError: "E3_PHASE4A_BOOTSTRAP_ROLE_DENIED",
  });
}

export function assertApprovedRuntimeUrl(raw) {
  return approvedConnection(raw, {
    role: RUNTIME_ROLE,
    pooled: true,
    roleError: "E3_PHASE4A_RUNTIME_ROLE_DENIED",
  });
}

async function main() {
  const command = process.argv[2];
  if (!new Set(["catalog", "runtime", "dry-run", "apply"]).has(command)) {
    throw new Error("E3_PHASE4A_VALIDATION_COMMAND_REQUIRED");
  }

  const environment = await loadLocalEnvironment();
  const bootstrapUrl = required(environment, "NEON_BOOTSTRAP_DATABASE_URL");
  const runtimeUrl = required(environment, "DATABASE_URL");
  const bootstrap = assertApprovedBootstrapUrl(bootstrapUrl);
  const runtime = assertApprovedRuntimeUrl(runtimeUrl);

  if (command === "catalog") {
    const assertions = await validateCatalog(bootstrapUrl);
    console.log(JSON.stringify({ command, bootstrap, runtime, assertions }));
    return;
  }
  if (command === "runtime") {
    const assertions = await validateRuntime(runtimeUrl);
    console.log(JSON.stringify({ command, bootstrap, runtime, assertions }));
    return;
  }

  const result = await runMigration(bootstrapUrl, command === "dry-run");
  console.log(JSON.stringify({ command, bootstrap, runtime, result }));
}

async function runMigration(connectionString, rollback) {
  const source = await readFile(
    new URL("../../neon/migrations/202608050008_e3_organization_department_alias.sql", import.meta.url),
    "utf8",
  );
  const statement = rollback
    ? source.replace(/\ncommit;\n[\s\S]*$/, "\nrollback;\n")
    : source;
  if (!statement.includes(rollback ? "\nrollback;\n" : "\ncommit;\n")) {
    throw new Error("E3_PHASE4A_MIGRATION_TRANSACTION_MISSING");
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await assertIdentity(client, BOOTSTRAP_ROLE, "E3_PHASE4A_BOOTSTRAP_IDENTITY_MISMATCH");
    await client.query(statement);
    return { applied: !rollback, rolledBack: rollback };
  } finally {
    await client.end();
  }
}

async function validateCatalog(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin read only");
    await assertIdentity(client, BOOTSTRAP_ROLE, "E3_PHASE4A_BOOTSTRAP_IDENTITY_MISMATCH");
    const catalog = await client.query(`
      select
        pg_catalog.to_regprocedure(
          'public.read_neon_organization_department_aliases(text)'
        ) is not null as read_exists,
        pg_catalog.to_regprocedure(
          'public.resolve_neon_organization_department_alias(text,uuid,text,uuid)'
        ) is not null as resolve_exists,
        pg_catalog.to_regprocedure(
          'app_private.neon_organization_actor_can_read_aliases()'
        ) is not null as reader_helper_exists,
        pg_catalog.to_regclass(
          'app_private.organization_alias_resolution_audit_events'
        ) is not null as audit_exists,
        (select relrowsecurity and relforcerowsecurity
         from pg_catalog.pg_class where oid = 'public.department_aliases'::regclass
        ) as alias_rls_forced,
        not pg_catalog.has_table_privilege(
          'hotel_ld_application', 'public.department_aliases',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        ) as no_runtime_alias_privileges
    `);
    const row = catalog.rows[0];
    if (
      row?.read_exists !== true || row.resolve_exists !== true ||
      row.reader_helper_exists !== true || row.audit_exists !== true ||
      row.alias_rls_forced !== true || row.no_runtime_alias_privileges !== true
    ) {
      throw new Error("E3_PHASE4A_CATALOG_DRIFT");
    }

    const security = await client.query(`
      select count(*)::integer as secured_entrypoints
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_roles owner_role on owner_role.oid = routine.proowner
      where routine.oid = any (array[
        pg_catalog.to_regprocedure('public.read_neon_organization_department_aliases(text)'),
        pg_catalog.to_regprocedure('public.resolve_neon_organization_department_alias(text,uuid,text,uuid)')
      ]::regprocedure[])
        and owner_role.rolname = 'hotel_ld_migration_owner'
        and routine.prosecdef
        and routine.proconfig = array['search_path=""']::text[]
        and not pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
        and pg_catalog.has_function_privilege(
          'hotel_ld_application', routine.oid, 'EXECUTE'
        )
    `);
    if (security.rows[0]?.secured_entrypoints !== 2) {
      throw new Error("E3_PHASE4A_ENTRYPOINT_SECURITY_DRIFT");
    }
    return {
      functions: 2,
      forcedRls: true,
      noRawAliasPrivileges: true,
      appendOnlyAudit: true,
    };
  } finally {
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }
}

async function validateRuntime(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin read only");
    await assertIdentity(client, RUNTIME_ROLE, "E3_PHASE4A_RUNTIME_IDENTITY_MISMATCH");
    const topology = await client.query(`
      select
        (select not rolbypassrls from pg_catalog.pg_roles
         where rolname = current_user) as no_bypass_rls,
        not pg_catalog.has_table_privilege(
          current_user, 'public.department_aliases',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        ) as no_alias_table_privileges,
        pg_catalog.has_function_privilege(
          current_user,
          'public.read_neon_organization_department_aliases(text)', 'EXECUTE'
        ) as read_execute,
        pg_catalog.has_function_privilege(
          current_user,
          'public.resolve_neon_organization_department_alias(text,uuid,text,uuid)',
          'EXECUTE'
        ) as resolve_execute
    `);
    const row = topology.rows[0];
    if (
      row?.no_bypass_rls !== true || row.no_alias_table_privileges !== true ||
      row.read_execute !== true || row.resolve_execute !== true
    ) {
      throw new Error("E3_PHASE4A_RUNTIME_TOPOLOGY_DRIFT");
    }

    const entrypointDeniedWithoutActor = await expectFailure(
      client,
      "e3_phase4a_entrypoint_without_actor",
      "select public.read_neon_organization_department_aliases('example.invalid')",
    );
    const rawReadDenied = await expectFailure(
      client,
      "e3_phase4a_raw_alias_read",
      "select 1 from public.department_aliases limit 1",
    );
    const rawWriteDenied = await expectFailure(
      client,
      "e3_phase4a_raw_alias_write",
      "update public.department_aliases set is_active = is_active where false",
    );
    return {
      noBypassRls: true,
      noRawAliasPrivileges: true,
      entrypointRequiresActor: entrypointDeniedWithoutActor,
      rawReadDenied,
      rawWriteDenied,
    };
  } finally {
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }
}

async function assertIdentity(client, role, errorCode) {
  const identity = await client.query(
    "select current_database() as database, current_user, session_user",
  );
  const row = identity.rows[0];
  if (
    row?.database !== DATABASE || row.current_user !== role ||
    row.session_user !== role
  ) {
    throw new Error(errorCode);
  }
}

async function expectFailure(client, savepoint, statement) {
  await client.query(`savepoint ${savepoint}`);
  try {
    await client.query(statement);
  } catch {
    await client.query(`rollback to savepoint ${savepoint}`);
    return true;
  }
  throw new Error("E3_PHASE4A_EXPECTED_DENIAL_MISSING");
}

function approvedConnection(raw, expected) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("E3_PHASE4A_DATABASE_URL_INVALID");
  }
  const hostname = url.hostname.toLowerCase();
  const role = decodeURIComponent(url.username);
  const database = url.pathname.replace(/^\//, "");
  const pooled = hostname.startsWith(`${DEVELOPMENT_ENDPOINT}-pooler.`);
  if (
    hostname.startsWith(`${PRODUCTION_ENDPOINT}.`) ||
    hostname.startsWith(`${PRODUCTION_ENDPOINT}-pooler.`)
  ) throw new Error("E3_PHASE4A_PRODUCTION_ENDPOINT_DENIED");
  if (
    !hostname.startsWith(`${DEVELOPMENT_ENDPOINT}.`) &&
    !hostname.startsWith(`${DEVELOPMENT_ENDPOINT}-pooler.`)
  ) throw new Error("E3_PHASE4A_CHILD_ENDPOINT_REQUIRED");
  if (database !== DATABASE) throw new Error("E3_PHASE4A_DATABASE_DENIED");
  if (role !== expected.role) throw new Error(expected.roleError);
  if (pooled !== expected.pooled) {
    throw new Error(expected.pooled
      ? "E3_PHASE4A_POOLED_RUNTIME_REQUIRED"
      : "E3_PHASE4A_DIRECT_BOOTSTRAP_REQUIRED");
  }
  return { endpoint: DEVELOPMENT_ENDPOINT, database, role, pooled };
}

async function loadLocalEnvironment() {
  let source;
  try {
    source = await readFile(process.env.E3_PHASE4A_ENV_FILE ?? ".env.local", "utf8");
  } catch {
    throw new Error("E3_PHASE4A_ENVIRONMENT_MISSING");
  }
  const environment = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) environment[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return environment;
}

function required(environment, key) {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`E3_PHASE4A_${key}_REQUIRED`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "E3_PHASE4A_UNKNOWN_ERROR");
    process.exitCode = 1;
  });
}
