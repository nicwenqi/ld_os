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
const MIGRATION = new URL("../../neon/migrations/202608060014_e4_position_mapping.sql", import.meta.url);

export function assertApprovedBootstrapUrl(raw) {
  return approved(raw, BOOTSTRAP_ROLE, false, "E4C_POSITION_MAPPING_BOOTSTRAP_ROLE_DENIED");
}

export function assertApprovedRuntimeUrl(raw) {
  return approved(raw, RUNTIME_ROLE, true, "E4C_POSITION_MAPPING_RUNTIME_ROLE_DENIED");
}

async function main() {
  const command = process.argv[2];
  if (!new Set(["source", "dry-run", "apply", "catalog", "runtime"]).has(command)) {
    throw new Error("E4C_POSITION_MAPPING_COMMAND_REQUIRED");
  }
  if (command === "source") return output(command, await sourceCheck());
  const values = await environmentValues();
  if (command === "runtime") {
    const runtimeUrl = required(values, "DATABASE_URL");
    return output(command, await runtime(runtimeUrl));
  }
  const bootstrapUrl = required(values, "NEON_BOOTSTRAP_DATABASE_URL");
  if (command === "catalog") return output(command, await catalog(bootstrapUrl));
  return output(command, await apply(bootstrapUrl, command === "dry-run"));
}

async function sourceCheck() {
  const source = await readFile(MIGRATION, "utf8");
  const fragments = [
    "read_neon_position_source_labels", "preview_neon_position_source_impact",
    "resolve_neon_position_alias", "position_mapping_audit_events",
    "security definer", "set search_path = ''", "for update",
    "import_source_rows_not_migrated", "revoke all on function",
    "to hotel_ld_application",
  ];
  if (!fragments.every(fragment => source.includes(fragment)) ||
      /syntheticEmployeeCount: 0|departmentNames: \[\]/.test(source) ||
      !/begin;[\s\S]*commit;\s*$/.test(source)) {
    throw new Error("E4C_POSITION_MAPPING_SOURCE_CONTRACT_MISSING");
  }
  return { transaction: true, entrypoints: 3, unavailableImpactExplicit: true };
}

async function apply(raw, rollback) {
  const bootstrap = assertApprovedBootstrapUrl(raw);
  const source = await readFile(MIGRATION, "utf8");
  const sql = rollback ? source.replace(/\ncommit;\s*$/, "\nrollback;\n") : source;
  const client = new pg.Client({ connectionString: raw });
  await client.connect();
  try {
    await identity(client, BOOTSTRAP_ROLE, "E4C_POSITION_MAPPING_BOOTSTRAP_IDENTITY_MISMATCH");
    await client.query(sql);
    return { bootstrap, applied: !rollback, rolledBack: rollback };
  } finally { await client.end(); }
}

async function catalog(raw) {
  const bootstrap = assertApprovedBootstrapUrl(raw);
  const client = new pg.Client({ connectionString: raw });
  await client.connect();
  try {
    await client.query("begin read only");
    await identity(client, BOOTSTRAP_ROLE, "E4C_POSITION_MAPPING_BOOTSTRAP_IDENTITY_MISMATCH");
    const row = (await client.query(`
      select
        (select count(*) = 3 from pg_catalog.pg_proc routine
          join pg_catalog.pg_roles owner_role on owner_role.oid = routine.proowner
          where routine.oid = any (array[
            pg_catalog.to_regprocedure('public.read_neon_position_source_labels(text)'),
            pg_catalog.to_regprocedure('public.preview_neon_position_source_impact(text,uuid)'),
            pg_catalog.to_regprocedure('public.resolve_neon_position_alias(text,uuid,text,uuid,text,text)')
          ]::regprocedure[])
          and owner_role.rolname = 'hotel_ld_migration_owner' and routine.prosecdef
          and routine.proconfig = array['search_path=""']::text[]
          and not pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
          and pg_catalog.has_function_privilege('hotel_ld_application', routine.oid, 'EXECUTE')
        ) as entrypoints_ok,
        (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class
          where oid = 'app_private.position_mapping_audit_events'::regclass) as audit_rls,
        exists(select 1 from pg_catalog.pg_trigger where tgrelid = 'app_private.position_mapping_audit_events'::regclass
          and tgname = 'e4c_position_mapping_audit_append_only' and not tgisinternal) as append_only,
        not exists(select 1 from pg_catalog.unnest(array[
          'public.position_aliases', 'public.positions', 'public.position_families',
          'app_private.position_mapping_audit_events'
        ]) relation(value) where pg_catalog.has_table_privilege('hotel_ld_application', relation.value,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as no_raw,
        (select not rolbypassrls and not rolsuper from pg_catalog.pg_roles where rolname = 'hotel_ld_application') as runtime_restricted
    `)).rows[0];
    if (!row?.entrypoints_ok || !row.audit_rls || !row.append_only || !row.no_raw || !row.runtime_restricted) {
      throw new Error("E4C_POSITION_MAPPING_CATALOG_DRIFT");
    }
    return { bootstrap, constrainedEntrypoints: true, forcedAuditRls: true, appendOnlyAudit: true, noRawApplicationPrivilege: true };
  } finally { try { await client.query("rollback"); } finally { await client.end(); } }
}

async function runtime(raw) {
  const runtime = assertApprovedRuntimeUrl(raw);
  const client = new pg.Client({ connectionString: raw });
  await client.connect();
  try {
    await identity(client, RUNTIME_ROLE, "E4C_POSITION_MAPPING_RUNTIME_IDENTITY_MISMATCH");
    await client.query("begin read only");
    const result = {
      runtime,
      rawAliasDenied: await denied(client, "alias", "select 1 from public.position_aliases limit 1"),
      rawPositionDenied: await denied(client, "position", "select 1 from public.positions limit 1"),
      rawFamilyDenied: await denied(client, "family", "select 1 from public.position_families limit 1"),
      rawAuditDenied: await denied(client, "audit", "select 1 from app_private.position_mapping_audit_events limit 1"),
      noActorEntrypointDenied: await denied(client, "no_actor", "select public.read_neon_position_source_labels('example.invalid')"),
    };
    await client.query("rollback");
    await client.query("begin");
    await client.query("select pg_catalog.set_config('app.actor_auth_user_id','11111111-1111-4111-8111-111111111111',true)");
    await client.query("rollback");
    const clean = (await client.query("select nullif(pg_catalog.current_setting('app.actor_auth_user_id',true),'') is null as clean")).rows[0]?.clean;
    if (!clean) throw new Error("E4C_POSITION_MAPPING_ACTOR_CONTEXT_LEAK");
    return { ...result, actorContextCleanup: true, connectionReuseClean: true, identityMatrix: "deferred: requires configured non-production manager and department-admin identities" };
  } finally { try { await client.query("rollback"); } finally { await client.end(); } }
}

async function denied(client, name, sql) {
  await client.query(`savepoint ${name}`);
  try { await client.query(sql); } catch { await client.query(`rollback to savepoint ${name}`); return true; }
  throw new Error("E4C_POSITION_MAPPING_EXPECTED_DENIAL_MISSING");
}

function approved(raw, role, pooled, roleError) {
  if (typeof raw !== "string" || raw.includes(PRODUCTION_BRANCH) || raw.includes(PRODUCTION_ENDPOINT)) {
    throw new Error("E4C_POSITION_MAPPING_PRODUCTION_DENIED");
  }
  let url;
  try { url = new URL(raw); } catch { throw new Error("E4C_POSITION_MAPPING_URL_INVALID"); }
  const host = url.hostname.toLowerCase();
  const direct = host.startsWith(`${CHILD_ENDPOINT}.`);
  const pooler = host.startsWith(`${CHILD_ENDPOINT}-pooler.`);
  if (!direct && !pooler) throw new Error("E4C_POSITION_MAPPING_CHILD_ENDPOINT_REQUIRED");
  if (url.pathname.replace(/^\//, "") !== DATABASE) throw new Error("E4C_POSITION_MAPPING_DATABASE_DENIED");
  if (decodeURIComponent(url.username) !== role) throw new Error(roleError);
  if (pooler !== pooled) throw new Error(pooled ? "E4C_POSITION_MAPPING_POOLED_RUNTIME_REQUIRED" : "E4C_POSITION_MAPPING_DIRECT_BOOTSTRAP_REQUIRED");
  return { branch: CHILD_BRANCH, endpoint: CHILD_ENDPOINT, database: DATABASE, role, pooled };
}

async function identity(client, role, message) {
  const row = (await client.query("select current_database() as database,current_user,session_user")).rows[0];
  if (row?.database !== DATABASE || row.current_user !== role || row.session_user !== role) throw new Error(message);
}

async function environmentValues() {
  let source;
  try { source = await readFile(process.env.E4C_POSITION_MAPPING_ENV_FILE ?? ".env.local", "utf8"); }
  catch { throw new Error("E4C_POSITION_MAPPING_ENVIRONMENT_MISSING"); }
  return Object.fromEntries(source.split(/\r?\n/)
    .map(line => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, "")]));
}

function required(values, key) {
  const value = values[key]?.trim();
  if (!value) throw new Error(`E4C_POSITION_MAPPING_${key}_REQUIRED`);
  return value;
}

function output(command, assertions) { console.log(JSON.stringify({ command, child: { branch: CHILD_BRANCH, endpoint: CHILD_ENDPOINT }, assertions })); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "E4C_POSITION_MAPPING_UNKNOWN"); process.exitCode = 1; });
}
