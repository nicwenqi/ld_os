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
    roleError: "E3_PHASE3_BOOTSTRAP_ROLE_DENIED",
  });
}

export function assertApprovedRuntimeUrl(raw) {
  return approvedConnection(raw, {
    role: RUNTIME_ROLE,
    pooled: true,
    roleError: "E3_PHASE3_RUNTIME_ROLE_DENIED",
  });
}

async function main() {
  const command = process.argv[2];
  if (!new Set(["catalog", "runtime", "dry-run", "apply"]).has(command)) {
    throw new Error("E3_PHASE3_VALIDATION_COMMAND_REQUIRED");
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

async function validateRuntime(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin read only");
    const identity = await client.query(`
      select current_database() as database,
             current_user as current_user,
             session_user as session_user,
             (select not rolbypassrls from pg_catalog.pg_roles
               where rolname = current_user) as no_bypass_rls,
             not pg_catalog.has_table_privilege(
               current_user, 'public.departments',
               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
             ) as no_department_table_privileges,
             not pg_catalog.has_table_privilege(
               current_user, 'public.department_closure',
               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
             ) as no_closure_table_privileges,
             pg_catalog.has_function_privilege(
               current_user,
               'public.preview_neon_organization_department_move(text,uuid,uuid)',
               'EXECUTE'
             ) as preview_execute,
             pg_catalog.has_function_privilege(
               current_user,
               'public.move_neon_organization_department(text,uuid,uuid,bigint)',
               'EXECUTE'
             ) as move_execute
    `);
    const row = identity.rows[0];
    if (
      row?.database !== DATABASE ||
      row.current_user !== RUNTIME_ROLE ||
      row.session_user !== RUNTIME_ROLE ||
      row.no_bypass_rls !== true ||
      row.no_department_table_privileges !== true ||
      row.no_closure_table_privileges !== true ||
      row.preview_execute !== true ||
      row.move_execute !== true
    ) {
      throw new Error("E3_PHASE3_RUNTIME_TOPOLOGY_DRIFT");
    }

    const entrypointDeniedWithoutActor = await expectFailure(
      client,
      "e3_phase3_entrypoint_without_actor",
      `select public.preview_neon_organization_department_move(
        'example.invalid',
        '00000000-0000-4000-8000-000000000001'::uuid,
        null
      )`,
    );
    const rawReadDenied = await expectFailure(
      client,
      "e3_phase3_raw_departments_read",
      "select 1 from public.departments limit 1",
    );
    return {
      noBypassRls: true,
      noRawBusinessTablePrivileges: true,
      entrypointRequiresActor: entrypointDeniedWithoutActor,
      rawReadDenied,
    };
  } finally {
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
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
  throw new Error("E3_PHASE3_EXPECTED_DENIAL_MISSING");
}

async function runMigration(connectionString, rollback) {
  const source = await readFile(
    new URL("../../neon/migrations/202608050007_e3_organization_department_move.sql", import.meta.url),
    "utf8",
  );
  const statement = rollback
    ? source.replace(/\ncommit;\n[\s\S]*$/, "\nrollback;\n")
    : source;
  if (!statement.includes(rollback ? "\nrollback;\n" : "\ncommit;\n")) {
    throw new Error("E3_PHASE3_MIGRATION_TRANSACTION_MISSING");
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const identity = await client.query(`
      select current_database() as database,
             current_user as current_user,
             session_user as session_user
    `);
    const row = identity.rows[0];
    if (
      row?.database !== DATABASE ||
      row.current_user !== BOOTSTRAP_ROLE ||
      row.session_user !== BOOTSTRAP_ROLE
    ) {
      throw new Error("E3_PHASE3_BOOTSTRAP_IDENTITY_MISMATCH");
    }
    await client.query(statement);
    return { applied: !rollback, rolledBack: rollback };
  } finally {
    await client.end();
  }
}

function approvedConnection(raw, expected) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("E3_PHASE3_DATABASE_URL_INVALID");
  }

  const hostname = url.hostname.toLowerCase();
  const role = decodeURIComponent(url.username);
  const database = url.pathname.replace(/^\//, "");
  const pooled = hostname.startsWith(`${DEVELOPMENT_ENDPOINT}-pooler.`);

  if (
    hostname.startsWith(`${PRODUCTION_ENDPOINT}.`) ||
    hostname.startsWith(`${PRODUCTION_ENDPOINT}-pooler.`)
  ) {
    throw new Error("E3_PHASE3_PRODUCTION_ENDPOINT_DENIED");
  }
  if (
    !hostname.startsWith(`${DEVELOPMENT_ENDPOINT}.`) &&
    !hostname.startsWith(`${DEVELOPMENT_ENDPOINT}-pooler.`)
  ) {
    throw new Error("E3_PHASE3_CHILD_ENDPOINT_REQUIRED");
  }
  if (database !== DATABASE) throw new Error("E3_PHASE3_DATABASE_DENIED");
  if (role !== expected.role) throw new Error(expected.roleError);
  if (pooled !== expected.pooled) {
    throw new Error(
      expected.pooled
        ? "E3_PHASE3_POOLED_RUNTIME_REQUIRED"
        : "E3_PHASE3_DIRECT_BOOTSTRAP_REQUIRED",
    );
  }

  return { endpoint: DEVELOPMENT_ENDPOINT, database, role, pooled };
}

async function validateCatalog(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin read only");
    const identity = await client.query(`
      select current_database() as database,
             current_user as current_user,
             session_user as session_user
    `);
    const row = identity.rows[0];
    if (
      row?.database !== DATABASE ||
      row.current_user !== BOOTSTRAP_ROLE ||
      row.session_user !== BOOTSTRAP_ROLE
    ) {
      throw new Error("E3_PHASE3_BOOTSTRAP_IDENTITY_MISMATCH");
    }

    const target = await client.query(`
      select
        pg_catalog.to_regprocedure(
          'public.preview_neon_organization_department_move(text,uuid,uuid)'
        ) is not null as preview_exists,
        pg_catalog.to_regprocedure(
          'public.move_neon_organization_department(text,uuid,uuid,bigint)'
        ) is not null as move_exists,
        pg_catalog.to_regprocedure(
          'app_private.lock_neon_organization_hierarchy(uuid)'
        ) is not null as lock_exists
    `);
    if (
      target.rows[0]?.preview_exists !== true ||
      target.rows[0]?.move_exists !== true ||
      target.rows[0]?.lock_exists !== true
    ) {
      throw new Error("E3_PHASE3_OBJECT_MISSING");
    }

    return { phase3Objects: 3 };
  } finally {
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }
}

async function loadLocalEnvironment() {
  let source;
  try {
    source = await readFile(".env.local", "utf8");
  } catch {
    throw new Error("E3_PHASE3_ENVIRONMENT_MISSING");
  }
  const environment = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    environment[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return environment;
}

function required(environment, key) {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`E3_PHASE3_${key}_REQUIRED`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "E3_PHASE3_UNKNOWN_ERROR");
    process.exitCode = 1;
  });
}
