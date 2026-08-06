import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";

const CHILD_ENDPOINT = "ep-sparkling-shape-az9gxtuh";
const PRODUCTION_ENDPOINT = "ep-wild-wave-azjmgdif";
const DATABASE = "neondb";
const BASE_MIGRATION = new URL("../../neon/migrations/202608060012_e4_position_write.sql", import.meta.url);
const HARDENING_MIGRATION = new URL("../../neon/migrations/202608060013_e4_position_write_lock_hardening.sql", import.meta.url);

export function assertApprovedBootstrapUrl(raw) {
  return approved(raw, "neondb_owner", false, "E4_POSITION_WRITE_BOOTSTRAP_ROLE_DENIED");
}

export function assertApprovedRuntimeUrl(raw) {
  return approved(raw, "hotel_ld_application", true, "E4_POSITION_WRITE_RUNTIME_ROLE_DENIED");
}

function approved(raw, role, pooled, roleError) {
  if (typeof raw !== "string" || raw.includes(PRODUCTION_ENDPOINT)) {
    throw new Error("E4_POSITION_WRITE_PRODUCTION_DENIED");
  }
  let url;
  try { url = new URL(raw); } catch { throw new Error("E4_POSITION_WRITE_URL_INVALID"); }
  const host = url.hostname.toLowerCase();
  const isPooled = host.startsWith(`${CHILD_ENDPOINT}-pooler.`);
  if (!(isPooled || host.startsWith(`${CHILD_ENDPOINT}.`))) {
    throw new Error("E4_POSITION_WRITE_CHILD_ENDPOINT_REQUIRED");
  }
  if (url.pathname.replace(/^\//, "") !== DATABASE) throw new Error("E4_POSITION_WRITE_DATABASE_DENIED");
  if (decodeURIComponent(url.username) !== role) throw new Error(roleError);
  if (isPooled !== pooled) throw new Error(pooled ? "E4_POSITION_WRITE_POOLED_RUNTIME_REQUIRED" : "E4_POSITION_WRITE_DIRECT_BOOTSTRAP_REQUIRED");
  return { endpoint: CHILD_ENDPOINT, database: DATABASE, role, pooled };
}

async function main() {
  const command = process.argv[2];
  if (!new Set(["source", "dry-run", "apply", "catalog", "runtime"]).has(command)) throw new Error("E4_POSITION_WRITE_COMMAND_REQUIRED");
  if (command === "source") return output(command, await sourceCheck());
  const env = await envValues();
  if (command === "runtime") {
    const url = required(env, "DATABASE_URL");
    assertApprovedRuntimeUrl(url);
    return output(command, await runtime(url));
  }
  const url = required(env, "NEON_BOOTSTRAP_DATABASE_URL");
  assertApprovedBootstrapUrl(url);
  output(command, command === "catalog" ? await catalog(url) : await migration(url, command === "dry-run"));
}

async function sourceCheck() {
  const [source, hardening] = await Promise.all([
    readFile(BASE_MIGRATION, "utf8"),
    readFile(HARDENING_MIGRATION, "utf8"),
  ]);
  const requiredFragments = ["save_neon_position_family", "save_neon_position_with_departments", "position_write_audit_events", "security definer", "set search_path=''", "for update", "revoke all on function", "to hotel_ld_application"];
  if (!requiredFragments.every(fragment => source.toLowerCase().includes(fragment.toLowerCase()))
    || !/begin;[\s\S]*commit;\s*$/.test(source)
    || !/begin;[\s\S]*commit;\s*$/.test(hardening)
    || !/property[\s\S]*family[\s\S]*positions[\s\S]*departments[\s\S]*position_department_assignments/is.test(hardening)
    || !/version\s*=\s*version\s*\+\s*1/i.test(hardening)) {
    throw new Error("E4_POSITION_WRITE_SOURCE_CONTRACT_MISSING");
  }
  return { transaction: true, entrypoints: 2, atomicAssignmentBoundary: true, lockOrderHardened: true };
}

async function migration(url, rollback) {
  const source = await readFile(HARDENING_MIGRATION, "utf8");
  const statement = rollback ? source.replace(/\ncommit;\s*$/, "\nrollback;\n") : source;
  const client = new pg.Client({ connectionString: url }); await client.connect();
  try { await identity(client, "neondb_owner"); await client.query(statement); return { applied: !rollback, rolledBack: rollback }; }
  finally { await client.end(); }
}

async function catalog(url) {
  const client = new pg.Client({ connectionString: url }); await client.connect();
  try {
    await client.query("begin read only"); await identity(client, "neondb_owner");
    const row = (await client.query(`select
      (select count(*)=2 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner where p.oid=any(array[pg_catalog.to_regprocedure('public.save_neon_position_family(text,uuid,uuid,uuid,bigint,text,text,text,text,integer,boolean)'),pg_catalog.to_regprocedure('public.save_neon_position_with_departments(text,uuid,uuid,uuid,bigint,uuid,text,text,text,text,boolean,uuid[])')]::regprocedure[]) and r.rolname='hotel_ld_migration_owner' and p.prosecdef and p.proconfig=array['search_path=""']::text[] and not pg_catalog.has_function_privilege('public',p.oid,'EXECUTE') and pg_catalog.has_function_privilege('hotel_ld_application',p.oid,'EXECUTE')) as functions_ok,
      (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='app_private.position_write_audit_events'::regclass) as audit_rls,
      exists(select 1 from pg_catalog.pg_trigger where tgrelid='app_private.position_write_audit_events'::regclass and tgname='e4_position_write_audit_append_only' and not tgisinternal) as audit_append_only_trigger,
      position('version=version+1' in replace(lower(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.save_neon_position_with_departments(text,uuid,uuid,uuid,bigint,uuid,text,text,text,text,boolean,uuid[])'))),' ','')) > 0 as position_version_increment,
      not exists(select 1 from pg_catalog.unnest(array['public.position_families','public.positions','public.position_department_assignments','app_private.position_write_audit_events']) q(v) where pg_catalog.has_table_privilege('hotel_ld_application',v,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as no_raw`)).rows[0];
    if (!row?.functions_ok || !row.audit_rls || !row.audit_append_only_trigger || !row.position_version_increment || !row.no_raw) throw new Error("E4_POSITION_WRITE_CATALOG_DRIFT");
    return { constrainedEntrypoints: true, forceRls: true, auditAppendOnly: true, positionVersionIncrement: true, noRawApplicationPrivilege: true };
  } finally { try { await client.query("rollback"); } finally { await client.end(); } }
}

async function runtime(url) {
  const client = new pg.Client({ connectionString: url }); await client.connect();
  try {
    await identity(client, "hotel_ld_application"); await client.query("begin read only");
    const denied = async (name, sql) => { await client.query(`savepoint ${name}`); try { await client.query(sql); } catch { await client.query(`rollback to savepoint ${name}`); return true; } throw new Error("E4_POSITION_WRITE_EXPECTED_DENIAL_MISSING"); };
    const result = {
      rawFamilyDenied: await denied("family", "select 1 from public.position_families limit 1"),
      rawPositionDenied: await denied("position", "select 1 from public.positions limit 1"),
      rawAssignmentDenied: await denied("assignment", "select 1 from public.position_department_assignments limit 1"),
      rawAuditDenied: await denied("audit", "select 1 from app_private.position_write_audit_events limit 1"),
    };
    await client.query("rollback");

    await client.query("begin");
    result.noActorDenied = await denied("actor", "select public.save_neon_position_family('example.invalid','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',null,0,'x','x',null,null,0,true)");
    await client.query("select pg_catalog.set_config('app.actor_auth_user_id','11111111-1111-4111-8111-111111111111',true)");
    await client.query("rollback");
    const contextCleared = value => value == null || value === "";
    result.actorContextClearedAfterRollback = contextCleared((await client.query("select pg_catalog.current_setting('app.actor_auth_user_id',true) value")).rows[0]?.value);
    result.connectionReuseClean = contextCleared((await client.query("select pg_catalog.current_setting('app.actor_auth_user_id',true) value")).rows[0]?.value);
    if (!result.actorContextClearedAfterRollback || !result.connectionReuseClean) throw new Error("E4_POSITION_WRITE_ACTOR_CONTEXT_LEAK");
    return result;
  } finally { try { await client.query("rollback"); } finally { await client.end(); } }
}

async function identity(client, role) { const row = (await client.query("select current_database() database,current_user,session_user")).rows[0]; if (row?.database !== DATABASE || row.current_user !== role || row.session_user !== role) throw new Error("E4_POSITION_WRITE_IDENTITY_MISMATCH"); }
async function envValues() { const source = await readFile(process.env.E4_POSITION_WRITE_ENV_FILE ?? ".env.local", "utf8"); return Object.fromEntries(source.split(/\r?\n/).map(line => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, "")])); }
function required(values, key) { if (!values[key]?.trim()) throw new Error(`E4_POSITION_WRITE_${key}_REQUIRED`); return values[key].trim(); }
function output(command, assertions) { console.log(JSON.stringify({ command, child: { endpoint: CHILD_ENDPOINT, database: DATABASE }, assertions })); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error instanceof Error ? error.message : "E4_POSITION_WRITE_UNKNOWN"); process.exitCode = 1; });
