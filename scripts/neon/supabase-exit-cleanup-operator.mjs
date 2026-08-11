import pg from "pg";
import { APPROVED_NEON_FIRST_INITIALIZATION_TARGETS } from "./neon-first-initialization-targets.mjs";
import { validateDirectBootstrapConnection } from "./neon-first-initialization-operator.mjs";

const { Pool } = pg;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS = Object.freeze(["tenantId", "propertyId", "authUserId", "profileId", "accountId", "roleAssignmentId", "positionDepartmentAssignmentId", "objectPrefix"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function validateFixture(fixture) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture) || Object.keys(fixture).length !== KEYS.length || KEYS.some(key => !(key in fixture))) fail("SUPABASE_EXIT_CLEANUP_FIXTURE_INVALID");
  for (const key of KEYS.slice(0, -1)) if (!UUID.test(fixture[key])) fail("SUPABASE_EXIT_CLEANUP_FIXTURE_INVALID");
  const expectedPrefix = `${fixture.tenantId}/${fixture.propertyId}/imports/`;
  if (fixture.objectPrefix !== expectedPrefix) fail("SUPABASE_EXIT_CLEANUP_FIXTURE_INVALID");
}

export function validateSupabaseExitCleanup({ fixture, target, connectionString }) {
  validateFixture(fixture);
  if (!target || target.environment === "production" || !APPROVED_NEON_FIRST_INITIALIZATION_TARGETS.some(candidate => Object.keys(candidate).every(key => candidate[key] === target[key]))) fail("SUPABASE_EXIT_CLEANUP_TARGET_FORBIDDEN");
  validateDirectBootstrapConnection(connectionString, target);
  return true;
}

const SQL = Object.freeze({
  e5bRelations: `select
    to_regclass('public.import_batches') as import_batches,
    to_regclass('public.import_commits') as import_commits,
    to_regclass('app_private.import_activity_events') as import_activity_events,
    to_regclass('app_private.import_decision_audit_events') as import_decision_audit_events,
    to_regclass('app_private.import_commit_audit_events') as import_commit_audit_events`,
  preservedImportAuditCount: `
    select (
      (select count(*) from app_private.import_activity_events where tenant_id = $1 and property_id = $2) +
      (select count(*) from app_private.import_decision_audit_events where tenant_id = $1 and property_id = $2) +
      (select count(*) from app_private.import_commit_audit_events where tenant_id = $1 and property_id = $2)
    )::integer as count`,
  committedImportCount: "select count(*)::integer as count from public.import_commits where tenant_id = $1 and property_id = $2 and status <> 'reverted'",
  importedEmployees: "update public.employees set is_active = false, employment_status = 'inactive' where tenant_id = $1 and property_id = $2 and is_active",
  identifiers: "update public.employee_external_identifiers set is_active = false where tenant_id = $1 and property_id = $2 and is_active",
  positions: "update public.positions set is_active = false where tenant_id = $1 and property_id = $2 and is_active",
  families: "update public.position_families set is_active = false where tenant_id = $1 and property_id = $2 and is_active",
  units: "update public.operational_units set is_active = false where tenant_id = $1 and property_id = $2 and is_active",
  departments: "update public.departments set is_active = false where tenant_id = $1 and property_id = $2 and is_active",
  positionDepartmentAssignments: "update public.position_department_assignments set is_active = false where id = $3 and tenant_id = $1 and property_id = $2 and is_active",
  assignments: "update public.role_assignments set status = 'inactive' where tenant_id = $1 and property_id = $2 and status = 'active'",
  propertyMemberships: "update public.property_memberships set status = 'inactive' where tenant_id = $1 and property_id = $2 and status = 'active'",
  tenantMemberships: "update public.tenant_memberships set status = 'inactive' where tenant_id = $1 and user_id = $3 and status = 'active'",
  accounts: "update public.user_accounts set account_status = 'inactive' where id = $3 and auth_user_id = $4 and tenant_id = $1 and property_id = $2 and account_status = 'active'",
  profiles: "update public.profiles set is_active = false where id = $1 and is_active",
  roles: "update public.roles set is_active = false where tenant_id = $1 and property_id = $2 and is_active",
  domains: "update public.property_domains set is_active = false where tenant_id = $1 and property_id = $2 and is_active",
  properties: "update public.properties set status = 'inactive' where tenant_id = $1 and id = $2 and status <> 'inactive'",
  tenants: "update public.tenants set status = 'inactive' where id = $1 and status <> 'inactive'",
  terminalProof: `select
    not exists(select 1 from public.user_accounts where id = $3 and auth_user_id = $4 and account_status = 'active')
    and not exists(select 1 from public.property_memberships where tenant_id = $1 and property_id = $2 and status = 'active')
    and not exists(select 1 from public.role_assignments where tenant_id = $1 and property_id = $2 and status = 'active')
    and not exists(select 1 from public.position_department_assignments where id = $5 and tenant_id = $1 and property_id = $2 and is_active)
    and not exists(select 1 from public.properties where tenant_id = $1 and id = $2 and status in ('initializing','active'))
    and not exists(select 1 from public.property_domains where tenant_id = $1 and property_id = $2 and is_active)
    and not exists(select 1 from public.employees where tenant_id = $1 and property_id = $2 and is_active)
    {{IMPORT_COMMIT_PROOF}}
    as terminal`,
});

/**
 * Exact-ID cleanup only. Append-only Import audit/history remains retained;
 * the aggregate is instead terminalized so it has no active identity, domain,
 * membership, role, employee, or import-commit execution path.
 */
export async function cleanupSupabaseExitFixture({ fixture, target = APPROVED_NEON_FIRST_INITIALIZATION_TARGETS[0], connectionString, client, pool } = {}) {
  validateSupabaseExitCleanup({ fixture, target, connectionString });
  if (!(client || pool)) pool = new Pool({ connectionString, max: 1, ssl: { rejectUnauthorized: true }, application_name: "supabase-exit-cleanup" });
  const db = client || await pool.connect();
  const release = !client;
  const pair = [fixture.tenantId, fixture.propertyId];
  try {
    await db.query("begin");
    const relations = (await db.query(SQL.e5bRelations)).rows?.[0] ?? {};
    const auditParts = [
      relations.import_activity_events ? "(select count(*) from app_private.import_activity_events where tenant_id = $1 and property_id = $2)" : null,
      relations.import_decision_audit_events ? "(select count(*) from app_private.import_decision_audit_events where tenant_id = $1 and property_id = $2)" : null,
      relations.import_commit_audit_events ? "(select count(*) from app_private.import_commit_audit_events where tenant_id = $1 and property_id = $2)" : null,
    ].filter(Boolean);
    const audit = auditParts.length
      ? await db.query(`select (${auditParts.join(" + ")})::integer as count`, pair)
      : { rows: [{ count: 0 }] };
    const importCommitProof = relations.import_commits
      ? "and not exists(select 1 from public.import_commits where tenant_id = $1 and property_id = $2 and status <> 'reverted')"
      : "";
    if (relations.import_commits && Number((await db.query(SQL.committedImportCount, pair)).rows?.[0]?.count ?? 0) !== 0) fail("SUPABASE_EXIT_CLEANUP_IMPORT_NOT_REVERTED");
    for (const key of ["importedEmployees", "identifiers", "positions", "families", "units", "departments"]) await db.query(SQL[key], pair);
    await db.query(SQL.positionDepartmentAssignments, [...pair, fixture.positionDepartmentAssignmentId]);
    await db.query(SQL.assignments, pair);
    await db.query(SQL.propertyMemberships, pair);
    await db.query(SQL.tenantMemberships, [fixture.tenantId, fixture.profileId]);
    await db.query(SQL.accounts, [...pair, fixture.accountId, fixture.authUserId]);
    await db.query(SQL.profiles, [fixture.profileId]);
    await db.query(SQL.roles, pair);
    await db.query(SQL.domains, pair);
    await db.query(SQL.properties, pair);
    await db.query(SQL.tenants, [fixture.tenantId]);
    const proof = await db.query(SQL.terminalProof.replace("{{IMPORT_COMMIT_PROOF}}", importCommitProof), [...pair, fixture.accountId, fixture.authUserId, fixture.positionDepartmentAssignmentId]);
    if (proof.rows?.[0]?.terminal !== true) fail("SUPABASE_EXIT_CLEANUP_TERMINAL_PROOF_FAILED");
    await db.query("commit");
    return { status: "terminalized", auditRetained: Number(audit.rows?.[0]?.count ?? 0) > 0, credentialsRecorded: false };
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
