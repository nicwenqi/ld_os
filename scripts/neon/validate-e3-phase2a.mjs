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
    roleError: "E3_PHASE2A_BOOTSTRAP_ROLE_DENIED",
  });
}

export function assertApprovedRuntimeUrl(raw) {
  return approvedConnection(raw, {
    role: RUNTIME_ROLE,
    pooled: true,
    roleError: "E3_PHASE2A_RUNTIME_ROLE_DENIED",
  });
}

async function main() {
  const command = process.argv[2];
  if (command !== "catalog" && command !== "runtime") {
    throw new Error("E3_PHASE2A_VALIDATION_COMMAND_REQUIRED");
  }

  const environment = await loadLocalEnvironment();
  const bootstrapUrl = required(environment, "NEON_BOOTSTRAP_DATABASE_URL");
  const runtimeUrl = required(environment, "DATABASE_URL");
  const bootstrap = assertApprovedBootstrapUrl(bootstrapUrl);
  const runtime = assertApprovedRuntimeUrl(runtimeUrl);

  if (command === "catalog") {
    const evidence = await validateCatalog(bootstrapUrl);
    console.log(JSON.stringify({
      command,
      bootstrap,
      runtime,
      assertions: evidence,
    }));
    return;
  }

  throw new Error("E3_PHASE2A_RUNTIME_VALIDATION_NOT_IMPLEMENTED");
}

function approvedConnection(raw, expected) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("E3_PHASE2A_DATABASE_URL_INVALID");
  }

  const hostname = url.hostname.toLowerCase();
  const role = decodeURIComponent(url.username);
  const database = url.pathname.replace(/^\//, "");
  const pooled = hostname.startsWith(`${DEVELOPMENT_ENDPOINT}-pooler.`);

  if (
    hostname.startsWith(`${PRODUCTION_ENDPOINT}.`) ||
    hostname.startsWith(`${PRODUCTION_ENDPOINT}-pooler.`)
  ) {
    throw new Error("E3_PHASE2A_PRODUCTION_ENDPOINT_DENIED");
  }
  if (
    !hostname.startsWith(`${DEVELOPMENT_ENDPOINT}.`) &&
    !hostname.startsWith(`${DEVELOPMENT_ENDPOINT}-pooler.`)
  ) {
    throw new Error("E3_PHASE2A_CHILD_ENDPOINT_REQUIRED");
  }
  if (database !== DATABASE) {
    throw new Error("E3_PHASE2A_DATABASE_DENIED");
  }
  if (role !== expected.role) {
    throw new Error(expected.roleError);
  }
  if (pooled !== expected.pooled) {
    throw new Error(
      expected.pooled
        ? "E3_PHASE2A_POOLED_RUNTIME_REQUIRED"
        : "E3_PHASE2A_DIRECT_BOOTSTRAP_REQUIRED",
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
      throw new Error("E3_PHASE2A_BOOTSTRAP_IDENTITY_MISMATCH");
    }

    const target = await client.query(`
      select
        pg_catalog.to_regprocedure(
          'public.create_neon_organization_department(text,uuid,uuid,uuid,text,text,text,text,integer)'
        ) is not null as create_exists,
        pg_catalog.to_regprocedure(
          'public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean)'
        ) is not null as update_exists,
        pg_catalog.to_regclass(
          'app_private.organization_write_audit_events'
        ) is not null as audit_exists
    `);
    if (
      target.rows[0]?.create_exists !== true ||
      target.rows[0]?.update_exists !== true ||
      target.rows[0]?.audit_exists !== true
    ) {
      throw new Error("E3_PHASE2A_OBJECT_MISSING");
    }

    const functions = await client.query(`
      select namespace.nspname,
             routine.proname,
             owner_role.rolname as owner,
             routine.prosecdef,
             routine.proconfig,
             pg_catalog.has_function_privilege(
               'hotel_ld_application', routine.oid, 'EXECUTE'
             ) as application_execute,
             exists (
               select 1
               from pg_catalog.aclexplode(
                 coalesce(
                   routine.proacl,
                   pg_catalog.acldefault('f', routine.proowner)
                 )
               ) acl
               where acl.grantee = 0
                 and acl.privilege_type = 'EXECUTE'
             ) as public_execute
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_namespace namespace
        on namespace.oid = routine.pronamespace
      join pg_catalog.pg_roles owner_role
        on owner_role.oid = routine.proowner
      where (
        namespace.nspname = 'public'
        and routine.proname in (
          'create_neon_organization_department',
          'update_neon_organization_department',
          'create_department',
          'update_department_details'
        )
      ) or (
        namespace.nspname = 'app_private'
        and routine.proname in (
          'prepare_department_insert',
          'insert_department_closure'
        )
      )
    `);
    const byName = new Map(
      functions.rows.map(functionRow => [
        `${functionRow.nspname}.${functionRow.proname}`,
        functionRow,
      ]),
    );
    for (const name of [
      "public.create_neon_organization_department",
      "public.update_neon_organization_department",
    ]) {
      const functionRow = byName.get(name);
      if (
        !functionRow ||
        functionRow.owner !== "hotel_ld_migration_owner" ||
        functionRow.prosecdef !== true ||
        functionRow.application_execute !== true ||
        functionRow.public_execute !== false ||
        !functionRow.proconfig?.includes('search_path=""')
      ) {
        throw new Error("E3_PHASE2A_ENTRYPOINT_DRIFT");
      }
    }
    for (const name of [
      "app_private.prepare_department_insert",
      "app_private.insert_department_closure",
    ]) {
      const functionRow = byName.get(name);
      if (
        !functionRow ||
        functionRow.owner !== "hotel_ld_migration_owner" ||
        functionRow.prosecdef !== false ||
        functionRow.public_execute !== false ||
        !functionRow.proconfig?.includes('search_path=""')
      ) {
        throw new Error("E3_PHASE2A_TRIGGER_HELPER_DRIFT");
      }
    }
    for (const name of [
      "public.create_department",
      "public.update_department_details",
    ]) {
      const functionRow = byName.get(name);
      if (
        !functionRow ||
        functionRow.public_execute !== false ||
        functionRow.application_execute !== false
      ) {
        throw new Error("E3_PHASE2A_LEGACY_EXECUTE_DRIFT");
      }
    }

    const relationSecurity = await client.query(`
      select relation.relname,
             relation.relrowsecurity,
             relation.relforcerowsecurity,
             pg_catalog.has_table_privilege(
               'hotel_ld_application', relation.oid,
               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
             ) as application_table_privilege,
             pg_catalog.has_any_column_privilege(
               'hotel_ld_application', relation.oid,
               'SELECT,INSERT,UPDATE,REFERENCES'
             ) as application_column_privilege,
             pg_catalog.has_table_privilege(
               'hotel_ld_people_read', relation.oid,
               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
             ) as people_table_privilege,
             pg_catalog.has_any_column_privilege(
               'hotel_ld_people_read', relation.oid,
               'SELECT,INSERT,UPDATE,REFERENCES'
             ) as people_column_privilege
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname in ('departments', 'department_closure')
    `);
    if (
      relationSecurity.rows.length !== 2 ||
      relationSecurity.rows.some(relation =>
        !relation.relrowsecurity ||
        !relation.relforcerowsecurity ||
        relation.application_table_privilege ||
        relation.application_column_privilege ||
        relation.people_table_privilege ||
        relation.people_column_privilege
      )
    ) {
      throw new Error("E3_PHASE2A_RAW_PRIVILEGE_OR_RLS_DRIFT");
    }

    const closureAuthority = await client.query(`
      select
        pg_catalog.has_table_privilege(
          'hotel_ld_migration_owner',
          'public.department_closure',
          'UPDATE,DELETE'
        ) as table_mutation,
        pg_catalog.has_any_column_privilege(
          'hotel_ld_migration_owner',
          'public.department_closure',
          'UPDATE'
        ) as column_update
    `);
    if (
      closureAuthority.rows[0]?.table_mutation !== false ||
      closureAuthority.rows[0]?.column_update !== false
    ) {
      throw new Error("E3_PHASE2A_CLOSURE_REWRITE_AUTHORITY_DRIFT");
    }

    const policyCount = await client.query(`
      select count(*)::integer as count
      from pg_catalog.pg_policies
      where schemaname in ('public', 'app_private')
        and policyname in (
          'e3_phase2a_departments_insert',
          'e3_phase2a_departments_update',
          'e3_phase2a_department_closure_insert',
          'e3_phase2a_position_assignments_blocker_read',
          'e3_phase2a_organization_write_audit_insert'
        )
    `);
    if (policyCount.rows[0]?.count !== 5) {
      throw new Error("E3_PHASE2A_POLICY_INVENTORY_DRIFT");
    }

    await client.query("rollback");
    return {
      targetObjects: 3,
      constrainedEntrypoints: 2,
      constrainedTriggerHelpers: 2,
      protectedRelations: 2,
      writePolicies: 5,
      rawRuntimePrivileges: 0,
      closureRewritePrivileges: 0,
    };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Connection teardown below is the remaining safe action.
    }
    throw error;
  } finally {
    await client.end();
  }
}

async function loadLocalEnvironment() {
  const source = await readFile(".env.local", "utf8");
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return { ...values, ...process.env };
}

function required(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`E3_PHASE2A_${name}_MISSING`);
  return value;
}

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedAsScript) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "E3_PHASE2A_VALIDATION_FAILED");
    process.exitCode = 1;
  });
}
