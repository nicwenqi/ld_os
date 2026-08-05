import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";

const DEVELOPMENT_ENDPOINT = "ep-sparkling-shape-az9gxtuh";
const PRODUCTION_ENDPOINT = "ep-wild-wave-azjmgdif";
const DATABASE = "neondb";
const BOOTSTRAP_ROLE = "neondb_owner";
const RUNTIME_ROLE = "hotel_ld_application";

export function assertApprovedBootstrapUrl(raw) { return approved(raw, BOOTSTRAP_ROLE, false, "E3_PHASE4B_BOOTSTRAP_ROLE_DENIED"); }
export function assertApprovedRuntimeUrl(raw) { return approved(raw, RUNTIME_ROLE, true, "E3_PHASE4B_RUNTIME_ROLE_DENIED"); }

async function main() {
  const command = process.argv[2];
  if (!new Set(["dry-run", "apply", "catalog", "runtime"]).has(command)) throw new Error("E3_PHASE4B_VALIDATION_COMMAND_REQUIRED");
  const environment = await env();
  const bootstrapUrl = requireValue(environment, "NEON_BOOTSTRAP_DATABASE_URL");
  const runtimeUrl = requireValue(environment, "DATABASE_URL");
  const bootstrap = assertApprovedBootstrapUrl(bootstrapUrl);
  const runtime = assertApprovedRuntimeUrl(runtimeUrl);
  const assertions = command === "catalog" ? await catalog(bootstrapUrl) : command === "runtime" ? await runtimeCheck(runtimeUrl) : await migrate(bootstrapUrl, command === "dry-run");
  console.log(JSON.stringify({ command, bootstrap, runtime, assertions }));
}

async function migrate(connectionString, rollback) {
  const source = await readFile(new URL("../../neon/migrations/202608050009_e3_organization_operational_units.sql", import.meta.url), "utf8");
  const statement = rollback ? source.replace(/\ncommit;\n[\s\S]*$/, "\nrollback;\n") : source;
  if (!statement.includes(rollback ? "\nrollback;\n" : "\ncommit;\n")) throw new Error("E3_PHASE4B_MIGRATION_TRANSACTION_MISSING");
  const client = new pg.Client({ connectionString }); await client.connect();
  try { await identity(client, BOOTSTRAP_ROLE, "E3_PHASE4B_BOOTSTRAP_IDENTITY_MISMATCH"); await client.query(statement); return { applied: !rollback, rolledBack: rollback }; } finally { await client.end(); }
}

async function catalog(connectionString) {
  const client = new pg.Client({ connectionString }); await client.connect();
  try {
    await client.query("begin read only"); await identity(client, BOOTSTRAP_ROLE, "E3_PHASE4B_BOOTSTRAP_IDENTITY_MISMATCH");
    const result = await client.query(`select pg_catalog.to_regprocedure('public.read_neon_organization_operational_units(text)') is not null as read_exists,pg_catalog.to_regprocedure('public.create_neon_organization_operational_unit(text,uuid,uuid,uuid,uuid,text,text,text,text,integer,boolean)') is not null as create_exists,pg_catalog.to_regprocedure('public.update_neon_organization_operational_unit(text,uuid,bigint,uuid,uuid,text,text,text,text,integer,boolean)') is not null as update_exists,pg_catalog.to_regclass('app_private.organization_operational_unit_audit_events') is not null as audit_exists,(select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='public.operational_units'::regclass) as rls_forced,not pg_catalog.has_table_privilege('hotel_ld_application','public.operational_units','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as no_raw`);
    const row=result.rows[0]; if (!row?.read_exists||!row.create_exists||!row.update_exists||!row.audit_exists||!row.rls_forced||!row.no_raw) throw new Error("E3_PHASE4B_CATALOG_DRIFT"); return { functions:3,forcedRls:true,noRawOperationalUnitPrivileges:true,appendOnlyAudit:true };
  } finally { try { await client.query("rollback"); } finally { await client.end(); } }
}

async function runtimeCheck(connectionString) {
  const client=new pg.Client({connectionString}); await client.connect();
  try {
    await client.query("begin read only"); await identity(client,RUNTIME_ROLE,"E3_PHASE4B_RUNTIME_IDENTITY_MISMATCH");
    const top=await client.query(`select (select not rolbypassrls from pg_catalog.pg_roles where rolname=current_user) as no_bypass,not pg_catalog.has_table_privilege(current_user,'public.operational_units','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as no_raw,pg_catalog.has_function_privilege(current_user,'public.read_neon_organization_operational_units(text)','EXECUTE') as read_execute,pg_catalog.has_function_privilege(current_user,'public.create_neon_organization_operational_unit(text,uuid,uuid,uuid,uuid,text,text,text,text,integer,boolean)','EXECUTE') as create_execute,pg_catalog.has_function_privilege(current_user,'public.update_neon_organization_operational_unit(text,uuid,bigint,uuid,uuid,text,text,text,text,integer,boolean)','EXECUTE') as update_execute`);
    const row=top.rows[0]; if (!row?.no_bypass||!row.no_raw||!row.read_execute||!row.create_execute||!row.update_execute) throw new Error("E3_PHASE4B_RUNTIME_TOPOLOGY_DRIFT");
    return { noBypassRls:true,noRawOperationalUnitPrivileges:true,entrypointRequiresActor:await denied(client,"without_actor","select public.read_neon_organization_operational_units('example.invalid')"),rawReadDenied:await denied(client,"raw_read","select 1 from public.operational_units limit 1"),rawWriteDenied:await denied(client,"raw_write","update public.operational_units set is_active=is_active where false") };
  } finally { try { await client.query("rollback"); } finally { await client.end(); } }
}

async function denied(client,name,statement) { await client.query(`savepoint ${name}`); try { await client.query(statement); } catch { await client.query(`rollback to savepoint ${name}`); return true; } throw new Error("E3_PHASE4B_EXPECTED_DENIAL_MISSING"); }
async function identity(client,role,error) { const row=(await client.query("select current_database() as database,current_user,session_user")).rows[0]; if(row?.database!==DATABASE||row.current_user!==role||row.session_user!==role) throw new Error(error); }
function approved(raw,role,pooled,roleError) { let url; try { url=new URL(raw); } catch { throw new Error("E3_PHASE4B_DATABASE_URL_INVALID"); } const hostname=url.hostname.toLowerCase(); if(hostname.startsWith(`${PRODUCTION_ENDPOINT}.`)||hostname.startsWith(`${PRODUCTION_ENDPOINT}-pooler.`)) throw new Error("E3_PHASE4B_PRODUCTION_ENDPOINT_DENIED"); if(!hostname.startsWith(`${DEVELOPMENT_ENDPOINT}.`)&&!hostname.startsWith(`${DEVELOPMENT_ENDPOINT}-pooler.`)) throw new Error("E3_PHASE4B_CHILD_ENDPOINT_REQUIRED"); if(url.pathname.replace(/^\//,"")!==DATABASE) throw new Error("E3_PHASE4B_DATABASE_DENIED"); if(decodeURIComponent(url.username)!==role) throw new Error(roleError); const actual=hostname.startsWith(`${DEVELOPMENT_ENDPOINT}-pooler.`); if(actual!==pooled) throw new Error(pooled?"E3_PHASE4B_POOLED_RUNTIME_REQUIRED":"E3_PHASE4B_DIRECT_BOOTSTRAP_REQUIRED"); return {endpoint:DEVELOPMENT_ENDPOINT,database:DATABASE,role,pooled}; }
async function env() { let source; try { source=await readFile(process.env.E3_PHASE4B_ENV_FILE??".env.local","utf8"); } catch { throw new Error("E3_PHASE4B_ENVIRONMENT_MISSING"); } return Object.fromEntries(source.split(/\r?\n/).map(line=>line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map(([,k,v])=>[k,v.replace(/^['"]|['"]$/g,"")])); }
function requireValue(values,key) { const value=values[key]?.trim(); if(!value) throw new Error(`E3_PHASE4B_${key}_REQUIRED`); return value; }
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(error=>{console.error(error instanceof Error?error.message:"E3_PHASE4B_UNKNOWN_ERROR");process.exitCode=1;});
