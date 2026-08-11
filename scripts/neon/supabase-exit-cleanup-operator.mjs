import pg from "pg";
import { APPROVED_NEON_FIRST_INITIALIZATION_TARGETS } from "./neon-first-initialization-targets.mjs";
import { validateDirectBootstrapConnection } from "./neon-first-initialization-operator.mjs";

const { Pool } = pg;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS = Object.freeze(["tenantId", "propertyId", "authUserId", "profileId", "accountId", "roleAssignmentId", "objectPrefix"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function validateFixture(fixture) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture) || Object.keys(fixture).length !== KEYS.length || KEYS.some(key => !(key in fixture))) fail("SUPABASE_EXIT_CLEANUP_FIXTURE_INVALID");
  for (const key of KEYS.slice(0, -1)) if (!UUID.test(fixture[key])) fail("SUPABASE_EXIT_CLEANUP_FIXTURE_INVALID");
  const expectedPrefix = `imports/${fixture.tenantId}/${fixture.propertyId}/`;
  if (fixture.objectPrefix !== expectedPrefix) fail("SUPABASE_EXIT_CLEANUP_FIXTURE_INVALID");
}

export function validateSupabaseExitCleanup({ fixture, target, connectionString }) {
  validateFixture(fixture);
  if (!target || target.environment === "production" || !APPROVED_NEON_FIRST_INITIALIZATION_TARGETS.some(candidate => Object.keys(candidate).every(key => candidate[key] === target[key]))) fail("SUPABASE_EXIT_CLEANUP_TARGET_FORBIDDEN");
  validateDirectBootstrapConnection(connectionString, target);
  return true;
}

const SQL = Object.freeze({
  preservedImportAuditCount: `
    select (
      (select count(*) from app_private.import_activity_events where tenant_id = $1 and property_id = $2) +
      (select count(*) from app_private.import_decision_audit_events where tenant_id = $1 and property_id = $2) +
      (select count(*) from app_private.import_commit_audit_events where tenant_id = $1 and property_id = $2)
    )::integer as count`,
  importCommitItems: "delete from public.import_commit_items where tenant_id = $1 and property_id = $2",
  importCommits: "delete from public.import_commits where tenant_id = $1 and property_id = $2",
  issueResolutions: "delete from public.import_issue_resolutions where tenant_id = $1 and property_id = $2",
  labelDecisions: "delete from public.import_source_label_decisions where tenant_id = $1 and property_id = $2",
  mappingDecisions: "delete from public.import_field_mapping_decisions where tenant_id = $1 and property_id = $2",
  decisionVersions: "delete from public.import_decision_versions where tenant_id = $1 and property_id = $2",
  storageOperations: "delete from app_private.import_storage_operations where tenant_id = $1 and property_id = $2",
  labels: "delete from public.import_source_label_resolutions where tenant_id = $1 and property_id = $2",
  issues: "delete from public.import_issues where tenant_id = $1 and property_id = $2",
  mappings: "delete from public.import_field_mappings where tenant_id = $1 and property_id = $2",
  sourceRows: "delete from public.import_source_rows where tenant_id = $1 and property_id = $2",
  sheets: "delete from public.import_sheets where tenant_id = $1 and property_id = $2",
  batches: "delete from public.import_batches where tenant_id = $1 and property_id = $2",
  identifiers: "delete from public.employee_external_identifiers where tenant_id = $1 and property_id = $2",
  employees: "delete from public.employees where tenant_id = $1 and property_id = $2",
  positionAliases: "delete from public.position_aliases where tenant_id = $1 and property_id = $2",
  positionAssignments: "delete from public.position_department_assignments where tenant_id = $1 and property_id = $2",
  positions: "delete from public.positions where tenant_id = $1 and property_id = $2",
  families: "delete from public.position_families where tenant_id = $1 and property_id = $2",
  unitAliases: "delete from public.operational_unit_aliases where tenant_id = $1 and property_id = $2",
  units: "delete from public.operational_units where tenant_id = $1 and property_id = $2",
  departmentAliases: "delete from public.department_aliases where tenant_id = $1 and property_id = $2",
  closure: "delete from public.department_closure where tenant_id = $1 and property_id = $2",
  departments: "delete from public.departments where tenant_id = $1 and property_id = $2",
  steps: "delete from public.property_initialization_steps where tenant_id = $1 and property_id = $2",
  settings: "delete from public.property_settings where tenant_id = $1 and property_id = $2",
  assignments: "delete from public.role_assignments where id = $3 and tenant_id = $1 and property_id = $2",
  propertyMemberships: "delete from public.property_memberships where tenant_id = $1 and property_id = $2 and user_id = $3",
  tenantMemberships: "delete from public.tenant_memberships where tenant_id = $1 and user_id = $3",
  accounts: "delete from public.user_accounts where id = $3 and auth_user_id = $4 and tenant_id = $1 and property_id = $2",
  profiles: "delete from public.profiles where id = $1",
  domains: "delete from public.property_domains where tenant_id = $1 and property_id = $2",
  properties: "delete from public.properties where tenant_id = $1 and id = $2",
  tenants: "delete from public.tenants where id = $1",
});

/**
 * Exact-ID cleanup only. Append-only Import audit is intentionally retained;
 * once a workflow has created it, physical fixture deletion is rejected rather
 * than altering a trigger, schema, RLS, or historical evidence.
 */
export async function cleanupSupabaseExitFixture({ fixture, target = APPROVED_NEON_FIRST_INITIALIZATION_TARGETS[0], connectionString, client, pool } = {}) {
  validateSupabaseExitCleanup({ fixture, target, connectionString });
  if (!(client || pool)) pool = new Pool({ connectionString, max: 1, ssl: { rejectUnauthorized: true }, application_name: "supabase-exit-cleanup" });
  const db = client || await pool.connect();
  const release = !client;
  const pair = [fixture.tenantId, fixture.propertyId];
  try {
    await db.query("begin");
    const audit = await db.query(SQL.preservedImportAuditCount, pair);
    if (Number(audit.rows?.[0]?.count ?? 0) > 0) fail("SUPABASE_EXIT_CLEANUP_AUDIT_RETENTION_REQUIRED");
    const propertyDeletes = ["importCommitItems", "importCommits", "issueResolutions", "labelDecisions", "mappingDecisions", "decisionVersions", "storageOperations", "labels", "issues", "mappings", "sourceRows", "sheets", "batches", "identifiers", "employees", "positionAliases", "positionAssignments", "positions", "families", "unitAliases", "units", "departmentAliases", "closure", "departments", "steps", "settings"];
    for (const key of propertyDeletes) await db.query(SQL[key], pair);
    await db.query(SQL.assignments, [...pair, fixture.roleAssignmentId]);
    await db.query(SQL.propertyMemberships, [...pair, fixture.profileId]);
    await db.query(SQL.tenantMemberships, [fixture.tenantId, fixture.profileId]);
    await db.query(SQL.accounts, [...pair, fixture.accountId, fixture.authUserId]);
    await db.query(SQL.profiles, [fixture.profileId]);
    await db.query(SQL.domains, pair);
    await db.query(SQL.properties, pair);
    await db.query(SQL.tenants, [fixture.tenantId]);
    await db.query("commit");
    return { status: "cleaned", credentialsRecorded: false };
  } catch (error) {
    try { await db.query("rollback"); } catch { /* preserve exact failure */ }
    throw error;
  } finally {
    if (release) {
      db.release();
      await pool.end();
    }
  }
}
