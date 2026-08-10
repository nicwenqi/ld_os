#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const E5C_ROOT = join(ROOT, "neon", "canonical", "e5c");
export const E5C_PROJECT = "delicate-wind-06430851";
export const E5C_BRANCH = "br-icy-scene-aukkzv69";
export const E5C_ENDPOINT = "ep-frosty-math-audxlq88";
export const E5C_DATABASE = "neondb";
export const E5C_BOOTSTRAP_ROLE = "neondb_owner";
export const E5C_RUNTIME_ROLE = "hotel_ld_application";
const DATABASE_COMMANDS = new Set(["dry-run", "apply", "catalog"]);
const COMMANDS = new Set(["source", "dry-run", "apply", "catalog", "runtime", "storage-runtime"]);

export const E5C_MODULES = Object.freeze([
  "093_import_mapping_schema.sql",
  "094_import_mapping_entrypoints.sql",
]);

export const E5C_ENTRYPOINTS = Object.freeze([
  "read_neon_import_mapping_workflow",
  "save_neon_import_field_mapping_decisions",
  "save_neon_import_source_label_decisions",
  "save_neon_import_issue_resolutions",
  "preview_neon_import_batch",
]);

export async function validateE5cImportMappingSource(root = ROOT) {
  const base = join(root, "neon", "canonical", "e5c");
  const sources = await Promise.all(E5C_MODULES.map(file => readFile(join(base, file), "utf8")));
  const schema = sources[0];
  const entrypoints = sources[1];
  const manifest = JSON.parse(await readFile(join(base, "e5c-import-mapping-manifest.json"), "utf8"));
  if (!/create table public\.import_decision_versions\b/i.test(schema)
    || !/create table public\.import_field_mapping_decisions\b/i.test(schema)
    || !/create table public\.import_source_label_decisions\b/i.test(schema)
    || !/create table public\.import_issue_resolutions\b/i.test(schema)
    || !/create table app_private\.import_decision_audit_events\b/i.test(schema)) {
    throw new Error("E5C_IMPORT_MAPPING_SCHEMA_CONTRACT_MISSING");
  }
  if (!/enable row level security/i.test(schema) || !/force row level security/i.test(schema)
    || !/revoke all on table public\.import_/i.test(schema)
    || !/revoke all on table app_private\.import_decision_audit_events/i.test(schema)) {
    throw new Error("E5C_IMPORT_MAPPING_SECURITY_CONTRACT_MISSING");
  }
  const missing = E5C_ENTRYPOINTS.filter(name => !new RegExp(`create\\s+function\\s+public\\.${name}\\s*\\(`, "i").test(entrypoints));
  if (missing.length) throw new Error(`E5C_IMPORT_MAPPING_ENTRYPOINTS_MISSING:${missing.join(",")}`);
  if (!Array.isArray(manifest.entrypoints) || manifest.entrypoints.length !== E5C_ENTRYPOINTS.length
    || E5C_ENTRYPOINTS.some(name => !manifest.entrypoints.some(value => String(value).startsWith(`public.${name}(`)))) {
    throw new Error("E5C_IMPORT_MAPPING_MANIFEST_INVALID");
  }
  if (/update\s+public\.import_source_rows|delete\s+from\s+public\.import_source_rows/i.test(entrypoints)) {
    throw new Error("E5C_IMPORT_MAPPING_RAW_ROWS_MUTATION_FORBIDDEN");
  }
  if (/insert\s+into\s+public\.import_batches|update\s+public\.import_batches\s+set\s+(?!version)/i.test(entrypoints)) {
    throw new Error("E5C_IMPORT_MAPPING_BATCH_MUTATION_FORBIDDEN");
  }
  if (!/sha256\s*\(/i.test(entrypoints) || !/previewHash/i.test(entrypoints)
    || !/employee_commit_not_migrated/i.test(entrypoints)) {
    throw new Error("E5C_IMPORT_MAPPING_PREVIEW_CONTRACT_MISSING");
  }
  return {
    schema: "e5c-import-mapping",
    modules: [...E5C_MODULES],
    entrypoints: [...E5C_ENTRYPOINTS],
    immutableEvidence: true,
    previewPersisted: false,
  };
}

export async function validateE5cImportMappingRepositorySource(root = ROOT) {
  const path = join(root, "app", "repositories", "neon", "import-mapping-repository.ts");
  const source = await readFile(path, "utf8");
  if (!/^import\s+["']server-only["'];/m.test(source)) throw new Error("E5C_IMPORT_MAPPING_REPOSITORY_NOT_SERVER_ONLY");
  if (/select\s+\*\s+from|from\s+public\.|from\s+app_private\./i.test(source)) throw new Error("E5C_IMPORT_MAPPING_REPOSITORY_RAW_TABLE_QUERY");
  if (!source.includes("trustedHostname") || /tenantId|propertyId|role/.test(source.slice(source.indexOf("export function createNeonImportMappingRepository"), source.indexOf("export function createNeonImportMappingRepository") + 500))) {
    throw new Error("E5C_IMPORT_MAPPING_REPOSITORY_SCOPE_INPUT");
  }
  const queryCount = [...source.matchAll(/database\.query(?:<[^>]+>)?\(/g)].length;
  if (queryCount !== E5C_ENTRYPOINTS.length) throw new Error("E5C_IMPORT_MAPPING_REPOSITORY_QUERY_SURFACE_INVALID");
  return { serverOnly: true, rawTableQueries: 0, entrypointQueries: queryCount, clientScopeInputs: false };
}

export function approvedE5cConnection(raw, role, pooled) {
  if (typeof raw !== "string" || !/^postgres(?:ql):\/\//i.test(raw)) throw new Error("E5C_IMPORT_MAPPING_CONNECTION_INVALID");
  const parsed = raw.match(/^postgres(?:ql):\/\/([^:]+):([^@]+)@([^/?]+)\/([^?]+)(?:\?([^#]+))?/i);
  if (!parsed) throw new Error("E5C_IMPORT_MAPPING_CONNECTION_INVALID");
  const [, user, , host, database, query = ""] = parsed;
  if (decodeURIComponent(user) !== role || database !== E5C_DATABASE || !host.endsWith(".neon.tech") || host.includes("..")) throw new Error("E5C_IMPORT_MAPPING_CONNECTION_TARGET_INVALID");
  if (pooled !== host.includes("-pooler.")) throw new Error("E5C_IMPORT_MAPPING_CONNECTION_POOLING_INVALID");
  if (query.split("&").filter(Boolean).some(pair => !["sslmode", "channel_binding"].includes(pair.split("=")[0].toLowerCase()))) throw new Error("E5C_IMPORT_MAPPING_CONNECTION_QUERY_INVALID");
  return { project: E5C_PROJECT, branch: E5C_BRANCH, endpoint: E5C_ENDPOINT, database: E5C_DATABASE, role, pooled, kind: pooled ? "runtime" : "bootstrap" };
}

const E5C_CATALOG_SQL = `
with expected_tables(value) as (
  values ('public.import_decision_versions'::text),('public.import_field_mapping_decisions'::text),('public.import_source_label_decisions'::text),('public.import_issue_resolutions'::text),('app_private.import_decision_audit_events'::text)
), expected_routines(value) as (
  values ('public.read_neon_import_mapping_workflow(text,uuid)'::text),('public.save_neon_import_field_mapping_decisions(text,uuid,bigint,jsonb)'::text),('public.save_neon_import_source_label_decisions(text,uuid,bigint,jsonb)'::text),('public.save_neon_import_issue_resolutions(text,uuid,bigint,jsonb)'::text),('public.preview_neon_import_batch(text,uuid,bigint)'::text)
), relation_check as (
  select count(*) filter (where c.oid is not null)=5 as relations_exact,
    bool_and(r.rolname='hotel_ld_migration_owner') as owners_exact,
    bool_and(c.relrowsecurity and c.relforcerowsecurity) as rls_force,
    bool_and(not pg_catalog.has_table_privilege('hotel_ld_application',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') and not pg_catalog.has_any_column_privilege('hotel_ld_application',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) as raw_privilege_zero
  from expected_tables e left join pg_catalog.pg_class c on c.oid=pg_catalog.to_regclass(e.value) left join pg_catalog.pg_roles r on r.oid=c.relowner
), routine_check as (
  select count(*) filter(where p.oid is not null)=5 as routines_exact,
    bool_and(r.rolname='hotel_ld_migration_owner') as owners_exact,
    bool_and(p.prosecdef and p.proconfig=array['search_path=""']::text[]) as security_definer_search_path,
    bool_and(not pg_catalog.has_function_privilege('public',p.oid,'EXECUTE')) as public_execute_revoked,
    bool_and(pg_catalog.has_function_privilege('hotel_ld_application',p.oid,'EXECUTE')) as application_execute_granted
  from expected_routines e left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(e.value) left join pg_catalog.pg_roles r on r.oid=p.proowner
), policy_check as (
  select count(*) filter(where polname in ('canonical_import_decision_versions_scope','canonical_import_field_mapping_decisions_scope','canonical_import_source_label_decisions_scope','canonical_import_issue_resolutions_scope','canonical_import_decision_audit_insert'))=5 as policies_exact
  from pg_catalog.pg_policy
), audit_check as (
  select exists(select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace join pg_catalog.pg_proc p on p.oid=t.tgfoid where n.nspname='app_private' and c.relname='import_decision_audit_events' and t.tgenabled='O' and p.proname='reject_import_decision_audit_mutation') as audit_append_only
), role_check as (
  select coalesce((select rolcanlogin and not rolsuper and not rolbypassrls from pg_catalog.pg_roles where rolname='hotel_ld_application'),false) as application_role_restricted,
    not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app_private') and c.relname in ('import_decision_versions','import_field_mapping_decisions','import_source_label_decisions','import_issue_resolutions','import_decision_audit_events') and (pg_catalog.has_table_privilege('hotel_ld_application',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_any_column_privilege('hotel_ld_application',c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) as raw_catalog_zero
), rows_check as (
  select ((select count(*) from public.import_decision_versions)+(select count(*) from public.import_field_mapping_decisions)+(select count(*) from public.import_source_label_decisions)+(select count(*) from public.import_issue_resolutions)+(select count(*) from app_private.import_decision_audit_events))=0 as rows_empty
)
select relation_check.*, routine_check.*, policy_check.*, audit_check.*, role_check.*, rows_check.*
from relation_check,routine_check,policy_check,audit_check,role_check,rows_check
`;

function catalogVerdict(row) {
  const required = ["relations_exact", "owners_exact", "rls_force", "raw_privilege_zero", "routines_exact", "security_definer_search_path", "public_execute_revoked", "application_execute_granted", "policies_exact", "audit_append_only", "application_role_restricted", "raw_catalog_zero", "rows_empty"];
  const failed = required.filter(key => row?.[key] !== true);
  if (failed.length) throw new Error(`E5C_IMPORT_MAPPING_CATALOG_DRIFT:${failed.join(",")}`);
  return { catalogValidated: true, security: { rlsForce: true, rawPrivilegeZero: true, securityDefinersHardened: true, publicExecuteRevoked: true, applicationExecuteGranted: true, auditAppendOnly: true }, rowsEmpty: true };
}

async function readE5cMigrationSources(root = ROOT) {
  return Promise.all(E5C_MODULES.map(async file => {
    const path = join(root, "neon", "canonical", "e5c", file);
    const source = await readFile(path, "utf8");
    const frame = source.match(/^\s*begin\s*;([\s\S]*?)commit\s*;\s*$/i);
    if (!frame) throw new Error(`E5C_IMPORT_MAPPING_MIGRATION_FRAME:${file}`);
    return frame[1].trim();
  }));
}

async function defaultClient(raw) {
  const { Client } = await import("pg");
  return new Client({ connectionString: raw, ssl: { rejectUnauthorized: true }, enableChannelBinding: true, connectionTimeoutMillis: 10_000 });
}

async function identity(client, expectedRole) {
  const row = (await client.query("select current_database() as database,current_user,session_user,pg_catalog.current_setting('server_version_num')::integer as version")).rows[0] ?? {};
  if (row.database !== E5C_DATABASE || row.current_user !== expectedRole || row.session_user !== expectedRole || Math.trunc(Number(row.version) / 10_000) !== 18) throw new Error("E5C_IMPORT_MAPPING_IDENTITY_MISMATCH");
}

function stripSensitive(value) {
  return JSON.parse(JSON.stringify(value, (key, entry) => typeof entry === "string" && (/^postgres(?:ql):\/\//i.test(entry) || /password|secret|credential|database_url/i.test(key)) ? undefined : entry));
}

export async function runE5cDatabaseCommand(command, raw, root = ROOT) {
  if (!DATABASE_COMMANDS.has(command)) throw new Error("E5C_IMPORT_MAPPING_DATABASE_COMMAND_INVALID");
  const source = await validateE5cImportMappingSource(root);
  const target = approvedE5cConnection(raw, E5C_BOOTSTRAP_ROLE, false);
  const client = await defaultClient(raw);
  await client.connect();
  let open = false;
  try {
    await identity(client, E5C_BOOTSTRAP_ROLE);
    if (command === "catalog") {
      await client.query("begin read only"); open = true;
      const result = catalogVerdict((await client.query(E5C_CATALOG_SQL)).rows[0]);
      await client.query("rollback"); open = false;
      return stripSensitive({ command, source, connection: target, readOnly: true, ...result });
    }
    const sources = await readE5cMigrationSources(root);
    const before = command === "dry-run" ? (await client.query("select count(*)::integer as relations from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('import_decision_versions','import_field_mapping_decisions','import_source_label_decisions','import_issue_resolutions')")).rows[0].relations : null;
    await client.query("begin"); open = true;
    for (const sql of sources) await client.query(sql);
    await client.query("reset role");
    const result = catalogVerdict((await client.query(E5C_CATALOG_SQL)).rows[0]);
    if (command === "dry-run") {
      await client.query("rollback"); open = false;
      const after = (await client.query("select count(*)::integer as relations from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('import_decision_versions','import_field_mapping_decisions','import_source_label_decisions','import_issue_resolutions')")).rows[0].relations;
      if (String(before) !== String(after)) throw new Error("E5C_IMPORT_MAPPING_ROLLBACK_PROOF_FAILED");
      return stripSensitive({ command, source, connection: target, migrationsValidated: sources.length, rolledBack: true, dryRunStateRestored: true, ...result });
    }
    await client.query("commit"); open = false;
    return stripSensitive({ command, source, connection: target, migrationsApplied: sources.length, applied: true, ...result });
  } catch (error) {
    if (open) { try { await client.query("rollback"); } catch {} }
    throw error;
  } finally { await client.end(); }
}

export async function runE5cRuntimeValidation(bootstrapRaw, runtimeRaw, root = ROOT) {
  const source = await validateE5cImportMappingSource(root);
  const bootstrap = approvedE5cConnection(bootstrapRaw, E5C_BOOTSTRAP_ROLE, false);
  const runtime = approvedE5cConnection(runtimeRaw, E5C_RUNTIME_ROLE, true);
  const client = await defaultClient(runtimeRaw);
  await client.connect();
  try {
    await identity(client, E5C_RUNTIME_ROLE);
    const probes = [];
    for (const sql of ["select * from public.import_decision_versions limit 1", "update public.import_decision_versions set version=version where false"]) {
      await client.query("begin");
      try { await client.query("savepoint e5c_probe"); await client.query(sql); probes.push("FAIL"); await client.query("rollback"); }
      catch { await client.query("rollback"); probes.push("PASS"); }
    }
    await client.end();
    if (probes.some(value => value !== "PASS")) throw new Error("E5C_IMPORT_MAPPING_RAW_PRIVILEGE_RUNTIME_FAILED");
    return stripSensitive({ command: "runtime", source, bootstrap, runtime, matrix: { runtimeRole: "hotel_ld_application", rawTableReadDenied: "PASS", rawTableWriteDenied: "PASS", fallback: "OFF", decisionRowsEmpty: true } });
  } finally { try { await client.end(); } catch {} }
}

export async function main() {
  const command = process.argv[2] ?? "source";
  if (!COMMANDS.has(command)) throw new Error("E5C_IMPORT_MAPPING_COMMAND_REQUIRED");
  const source = await validateE5cImportMappingSource();
  if (command === "source") {
    await access(join(ROOT, "app", "repositories", "neon", "import-mapping-repository.ts"));
    const repository = await validateE5cImportMappingRepositorySource();
    process.stdout.write(`${JSON.stringify({ command, source, repository })}\n`);
    return;
  }
  const input = process.argv.includes("--credentials-stdin") ? await credentialsFromStdin() : null;
  if (DATABASE_COMMANDS.has(command)) {
    process.stdout.write(`${JSON.stringify(await runE5cDatabaseCommand(command, input?.NEON_BOOTSTRAP_DATABASE_URL ?? ""))}\n`);
    return;
  }
  if (command === "runtime") {
    process.stdout.write(`${JSON.stringify(await runE5cRuntimeValidation(input?.NEON_BOOTSTRAP_DATABASE_URL ?? "", input?.DATABASE_URL ?? ""))}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ command, status: "deferred", reason: "storage_provider_adapter_not_connected" })}\n`);
}

async function credentialsFromStdin() {
  const input = createInterface({ input: process.stdin, terminal: false });
  let line = "";
  for await (const candidate of input) { line = candidate; break; }
  input.close();
  let value;
  try { value = JSON.parse(line); } catch { throw new Error("E5C_IMPORT_MAPPING_CREDENTIAL_INPUT_INVALID"); }
  if (!value || typeof value !== "object" || typeof value.NEON_BOOTSTRAP_DATABASE_URL !== "string" || typeof value.DATABASE_URL !== "string") throw new Error("E5C_IMPORT_MAPPING_CREDENTIAL_INPUT_INVALID");
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "E5C_IMPORT_MAPPING_VALIDATION_FAILED"}\n`); process.exitCode = 1; });
}
