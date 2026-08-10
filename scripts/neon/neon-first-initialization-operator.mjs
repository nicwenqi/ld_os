import { randomUUID } from "node:crypto";
import pg from "pg";
import { NEON_FIRST_INITIALIZATION_STEP_KEYS, validateInitializationFixture, validateInitializationTarget } from "./neon-first-initialization-contract.mjs";
import { APPROVED_NEON_FIRST_INITIALIZATION_TARGETS } from "./neon-first-initialization-targets.mjs";

const { Pool } = pg;
const ALLOWED_URL_QUERY_KEYS = new Set(["sslmode", "channel_binding"]);
const CONFIRMED_STEPS = new Set(["identity", "organization", "positions", "access"]);

const SQL = Object.freeze({
  tenantExisting: "select id, code, name, status from public.tenants where id = $1 or code = $2 order by id",
  tenantInsert: "insert into public.tenants (id, code, name, status) values ($1, $2, $3, 'active') on conflict do nothing",
  propertyExisting: "select id, tenant_id, code, name_zh, name_en, status from public.properties where id = $1 or (tenant_id = $2 and code = $3) order by id",
  propertyInsert: "insert into public.properties (id, tenant_id, code, name_zh, name_en, country_region, timezone, default_language, status) values ($1, $2, $3, $4, $5, $6, $7, $8, 'active') on conflict do nothing",
  domainExisting: "select id, tenant_id, property_id, hostname, verification_status, is_active from public.property_domains where id = $1 or hostname = $2 order by id",
  domainInsert: "insert into public.property_domains (id, tenant_id, property_id, hostname, verification_status, is_active) values ($1, $2, $3, $4, 'verified', true) on conflict do nothing",
  profileExisting: "select id, display_name, email, is_active from public.profiles where id = $1 order by id",
  profileInsert: "insert into public.profiles (id, display_name, email, is_active) values ($1, $2, $3, true) on conflict do nothing",
  accountExisting: "select id, auth_user_id, user_id, tenant_id, property_id, account_status from public.user_accounts where id = $1 or auth_user_id = $2 or user_id = $3 order by id",
  accountInsert: "insert into public.user_accounts (id, auth_user_id, user_id, tenant_id, property_id, login_id, account_status, must_change_password) values ($1, $2, $3, $4, $5, $6, 'active', false) on conflict do nothing",
  tenantMembershipExisting: "select id, tenant_id, user_id, status from public.tenant_memberships where id = $1 or (tenant_id = $2 and user_id = $3) order by id",
  tenantMembershipInsert: "insert into public.tenant_memberships (id, tenant_id, user_id, status) values ($1, $2, $3, 'active') on conflict do nothing",
  propertyMembershipExisting: "select id, tenant_id, property_id, user_id, status from public.property_memberships where id = $1 or (property_id = $2 and user_id = $3) order by id",
  propertyMembershipInsert: "insert into public.property_memberships (id, tenant_id, property_id, user_id, status) values ($1, $2, $3, $4, 'active') on conflict do nothing",
  roleExisting: "select id, tenant_id, property_id, code, scope_level, is_active from public.roles where id = $1 or (tenant_id = $2 and property_id = $3 and code = $4) order by id",
  roleInsert: "insert into public.roles (id, tenant_id, property_id, code, scope_level, is_active) values ($1, $2, $3, 'property_ld_manager', 'property', true) on conflict do nothing",
  assignmentExisting: "select id, tenant_id, property_id, user_id, role_id, status from public.role_assignments where id = $1 or (tenant_id = $2 and property_id = $3 and user_id = $4 and role_id = $5) order by id",
  assignmentInsert: "insert into public.role_assignments (id, tenant_id, property_id, user_id, role_id, status) values ($1, $2, $3, $4, $5, 'active') on conflict do nothing",
  settingsExisting: "select id, tenant_id, property_id, initialization_state, initialization_last_active_step from public.property_settings where id = $1 or property_id = $2 order by id",
  settingsInsert: "insert into public.property_settings (id, tenant_id, property_id, new_employee_days, probation_field_meaning, employee_status_source, ctc_mandatory, gtc_mandatory, initialization_state, initialization_last_active_step, created_by, updated_by) values ($1, $2, $3, 90, 'confirmation_date', 'manual', true, true, 'in_progress', 5, $4, $4) on conflict do nothing",
  stepsExisting: "select id, step_key, explicitly_confirmed, tenant_id, property_id from public.property_initialization_steps where property_id = $1 order by step_key",
  stepInsert: "insert into public.property_initialization_steps (id, tenant_id, property_id, step_key, explicitly_confirmed, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, $6) on conflict do nothing",
  departmentExisting: "select id, tenant_id, property_id, is_active from public.departments where id = $1 or (property_id = $2 and code = 'DEV-OPS') order by id",
  departmentInsert: "insert into public.departments (id, tenant_id, property_id, parent_id, node_type, code, name_zh, name_en, sort_order, is_active) values ($1, $2, $3, null, 'department', 'DEV-OPS', '开发运营部', 'Development Operations', 0, true) on conflict do nothing",
  familyExisting: "select id, tenant_id, property_id, is_active from public.position_families where id = $1 or (property_id = $2 and code = 'DEV-OPS') order by id",
  familyInsert: "insert into public.position_families (id, tenant_id, property_id, code, name_zh, name_en, description, sort_order, is_active) values ($1, $2, $3, 'DEV-OPS', '开发运营', 'Development Operations', 'Neon-first development seed', 0, true) on conflict do nothing",
  positionExisting: "select id, tenant_id, property_id, is_active from public.positions where id = $1 or (property_id = $2 and code = 'DEV-OPS-001') order by id",
  positionInsert: "insert into public.positions (id, tenant_id, property_id, position_family_id, code, name_zh, name_en, grade_or_band, is_active) values ($1, $2, $3, $4, 'DEV-OPS-001', '开发运营经理', 'Development Operations Manager', 'M1', true) on conflict do nothing",
  assignmentSeedExisting: "select id, tenant_id, property_id, position_id, department_id, is_active from public.position_department_assignments where id = $1 or (position_id = $2 and department_id = $3) order by id",
  assignmentSeedInsert: "insert into public.position_department_assignments (id, tenant_id, property_id, position_id, department_id, is_primary, is_active) values ($1, $2, $3, $4, $5, true, true) on conflict do nothing",
  employeeExisting: "select id, tenant_id, property_id, employee_number, is_active from public.employees where id = $1 or (property_id = $2 and employee_number = 'DEV-001') order by id",
  employeeInsert: "insert into public.employees (id, tenant_id, property_id, employee_number, name_zh, name_en, department_id, position_id, position_family_id, grade_or_band, employment_status, is_active) values ($1, $2, $3, 'DEV-001', '开发示例员工', 'Development Seed Employee', $4, $5, $6, 'M1', 'active', true) on conflict do nothing",
  identifierExisting: "select id, tenant_id, property_id, employee_id, source_system, identifier_value, is_active from public.employee_external_identifiers where id = $1 or (property_id = $2 and source_system = 'neon-first-seed' and identifier_value = 'DEV-001') order by id",
  identifierInsert: "insert into public.employee_external_identifiers (id, tenant_id, property_id, employee_id, source_system, identifier_type, identifier_value, is_primary, is_active) values ($1, $2, $3, $4, 'neon-first-seed', 'local_employee_number', 'DEV-001', true, true) on conflict do nothing",
  organizationAudit: "insert into app_private.organization_write_audit_events (request_id, auth_user_id, actor_user_id, tenant_id, property_id, operation, target_id, details) values ($1, $2, $3, $4, $5, 'neon_first_initialization', $6, $7::jsonb)",
  propertyAudit: "insert into app_private.property_write_audit_events (request_id, auth_user_id, tenant_id, property_id, operation, target_id, details) values ($1, $2, $3, $4, 'neon_first_initialization', $5, $6::jsonb)",
  initializationAudit: "insert into app_private.initialization_audit_events (request_id, auth_user_id, tenant_id, property_id, operation, step_key, details) values ($1, $2, $3, $4, 'neon_first_initialization', null, $5::jsonb)",
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertExpectedRow(row, expected) {
  if (!row) fail("NEON_FIRST_INIT_ROW_MISSING");
  for (const [key, value] of Object.entries(expected)) if (row[key] !== value) fail("NEON_FIRST_INIT_ROW_CONFLICT");
}

async function ensure(client, { selectSql, selectValues, insertSql, insertValues, expected }) {
  const before = await client.query(selectSql, selectValues);
  if (before.rows.length > 1) fail("NEON_FIRST_INIT_ROW_CONFLICT");
  if (before.rows.length === 0) await client.query(insertSql, insertValues);
  const after = await client.query(selectSql, selectValues);
  if (after.rows.length !== 1) fail("NEON_FIRST_INIT_ROW_MISSING");
  assertExpectedRow(after.rows[0], expected);
  return before.rows.length === 0;
}

async function ensureSteps(client, fixture) {
  const before = await client.query(SQL.stepsExisting, [fixture.property.id]);
  if (before.rows.length > NEON_FIRST_INITIALIZATION_STEP_KEYS.length) fail("NEON_FIRST_INIT_ROW_CONFLICT");
  const beforeByKey = new Map(before.rows.map((row) => [row.step_key, row]));
  const created = [];
  for (const stepKey of NEON_FIRST_INITIALIZATION_STEP_KEYS) {
    const expected = {
      id: fixture.initialization.steps[stepKey],
      step_key: stepKey,
      explicitly_confirmed: CONFIRMED_STEPS.has(stepKey),
      tenant_id: fixture.tenant.id,
      property_id: fixture.property.id,
    };
    const current = beforeByKey.get(stepKey);
    if (current) assertExpectedRow(current, expected);
    else {
      await client.query(SQL.stepInsert, [expected.id, fixture.tenant.id, fixture.property.id, stepKey, expected.explicitly_confirmed, fixture.manager.profileId]);
      created.push(stepKey);
    }
  }
  const after = await client.query(SQL.stepsExisting, [fixture.property.id]);
  if (after.rows.length !== NEON_FIRST_INITIALIZATION_STEP_KEYS.length) fail("NEON_FIRST_INIT_ROW_MISSING");
  const afterByKey = new Map(after.rows.map((row) => [row.step_key, row]));
  for (const stepKey of NEON_FIRST_INITIALIZATION_STEP_KEYS) {
    assertExpectedRow(afterByKey.get(stepKey), {
      id: fixture.initialization.steps[stepKey], step_key: stepKey, explicitly_confirmed: CONFIRMED_STEPS.has(stepKey), tenant_id: fixture.tenant.id, property_id: fixture.property.id,
    });
  }
  return created.length > 0;
}

export function validateDirectBootstrapConnection(connectionString, target) {
  if (typeof connectionString !== "string" || connectionString.length < 20) fail("NEON_FIRST_INIT_BOOTSTRAP_URL_REQUIRED");
  let url;
  try { url = new URL(connectionString); } catch { fail("NEON_FIRST_INIT_BOOTSTRAP_URL_INVALID"); }
  if (!/^postgres(?:ql)?:$/.test(url.protocol) || !url.hostname.startsWith(target.directHostPrefix) || url.hostname.includes("-pooler.")) fail("NEON_FIRST_INIT_BOOTSTRAP_URL_INVALID");
  if (decodeURIComponent(url.username) !== "neondb_owner" || url.pathname !== `/${target.database}`) fail("NEON_FIRST_INIT_BOOTSTRAP_URL_INVALID");
  if ([...url.searchParams.keys()].some((key) => !ALLOWED_URL_QUERY_KEYS.has(key)) || url.searchParams.get("sslmode") !== "require" || (url.searchParams.has("channel_binding") && url.searchParams.get("channel_binding") !== "require")) fail("NEON_FIRST_INIT_BOOTSTRAP_URL_INVALID");
  return true;
}

export async function initializeNeonFirstEnvironment({ connectionString, target, fixture, authUserId, client, pool, environment = process.env, approvedTargets = APPROVED_NEON_FIRST_INITIALIZATION_TARGETS, requestId = randomUUID(), now = new Date(), dryRun = false }) {
  validateInitializationTarget(target, environment, approvedTargets);
  validateInitializationFixture(fixture, authUserId);
  validateDirectBootstrapConnection(connectionString, target);
  if (!(client || pool)) pool = new Pool({ connectionString, max: 1, ssl: { rejectUnauthorized: true }, application_name: "neon-first-initialization" });
  const dbClient = client || await pool.connect();
  const release = !client;
  const created = [];
  try {
    await dbClient.query("begin");
    const specs = [
      ["tenant", SQL.tenantExisting, [fixture.tenant.id, fixture.tenant.code], SQL.tenantInsert, [fixture.tenant.id, fixture.tenant.code, fixture.tenant.name], { id: fixture.tenant.id, code: fixture.tenant.code, name: fixture.tenant.name, status: "active" }],
      ["property", SQL.propertyExisting, [fixture.property.id, fixture.tenant.id, fixture.property.code], SQL.propertyInsert, [fixture.property.id, fixture.tenant.id, fixture.property.code, fixture.property.nameZh, fixture.property.nameEn, fixture.property.countryRegion, fixture.property.timezone, fixture.property.defaultLanguage], { id: fixture.property.id, tenant_id: fixture.tenant.id, code: fixture.property.code, name_zh: fixture.property.nameZh, name_en: fixture.property.nameEn, status: "active" }],
      ["propertyDomain", SQL.domainExisting, [fixture.propertyDomain.id, fixture.propertyDomain.hostname], SQL.domainInsert, [fixture.propertyDomain.id, fixture.tenant.id, fixture.property.id, fixture.propertyDomain.hostname], { id: fixture.propertyDomain.id, tenant_id: fixture.tenant.id, property_id: fixture.property.id, hostname: fixture.propertyDomain.hostname, verification_status: "verified", is_active: true }],
      ["profile", SQL.profileExisting, [fixture.manager.profileId], SQL.profileInsert, [fixture.manager.profileId, fixture.manager.displayName, fixture.manager.email], { id: fixture.manager.profileId, display_name: fixture.manager.displayName, email: fixture.manager.email, is_active: true }],
      ["userAccount", SQL.accountExisting, [fixture.manager.accountId, authUserId, fixture.manager.profileId], SQL.accountInsert, [fixture.manager.accountId, authUserId, fixture.manager.profileId, fixture.tenant.id, fixture.property.id, fixture.manager.loginId], { id: fixture.manager.accountId, auth_user_id: authUserId, user_id: fixture.manager.profileId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, account_status: "active" }],
      ["tenantMembership", SQL.tenantMembershipExisting, [fixture.manager.tenantMembershipId, fixture.tenant.id, fixture.manager.profileId], SQL.tenantMembershipInsert, [fixture.manager.tenantMembershipId, fixture.tenant.id, fixture.manager.profileId], { id: fixture.manager.tenantMembershipId, tenant_id: fixture.tenant.id, user_id: fixture.manager.profileId, status: "active" }],
      ["propertyMembership", SQL.propertyMembershipExisting, [fixture.manager.propertyMembershipId, fixture.property.id, fixture.manager.profileId], SQL.propertyMembershipInsert, [fixture.manager.propertyMembershipId, fixture.tenant.id, fixture.property.id, fixture.manager.profileId], { id: fixture.manager.propertyMembershipId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, user_id: fixture.manager.profileId, status: "active" }],
      ["role", SQL.roleExisting, [fixture.manager.roleId, fixture.tenant.id, fixture.property.id, "property_ld_manager"], SQL.roleInsert, [fixture.manager.roleId, fixture.tenant.id, fixture.property.id], { id: fixture.manager.roleId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, code: "property_ld_manager", scope_level: "property", is_active: true }],
      ["roleAssignment", SQL.assignmentExisting, [fixture.manager.roleAssignmentId, fixture.tenant.id, fixture.property.id, fixture.manager.profileId, fixture.manager.roleId], SQL.assignmentInsert, [fixture.manager.roleAssignmentId, fixture.tenant.id, fixture.property.id, fixture.manager.profileId, fixture.manager.roleId], { id: fixture.manager.roleAssignmentId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, user_id: fixture.manager.profileId, role_id: fixture.manager.roleId, status: "active" }],
      ["propertySettings", SQL.settingsExisting, [fixture.initialization.settingsId, fixture.property.id], SQL.settingsInsert, [fixture.initialization.settingsId, fixture.tenant.id, fixture.property.id, fixture.manager.profileId], { id: fixture.initialization.settingsId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, initialization_state: "in_progress", initialization_last_active_step: 5 }],
      ["department", SQL.departmentExisting, [fixture.developmentSeed.departmentId, fixture.property.id], SQL.departmentInsert, [fixture.developmentSeed.departmentId, fixture.tenant.id, fixture.property.id], { id: fixture.developmentSeed.departmentId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, is_active: true }],
      ["positionFamily", SQL.familyExisting, [fixture.developmentSeed.positionFamilyId, fixture.property.id], SQL.familyInsert, [fixture.developmentSeed.positionFamilyId, fixture.tenant.id, fixture.property.id], { id: fixture.developmentSeed.positionFamilyId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, is_active: true }],
      ["position", SQL.positionExisting, [fixture.developmentSeed.positionId, fixture.property.id], SQL.positionInsert, [fixture.developmentSeed.positionId, fixture.tenant.id, fixture.property.id, fixture.developmentSeed.positionFamilyId], { id: fixture.developmentSeed.positionId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, is_active: true }],
      ["positionDepartmentAssignment", SQL.assignmentSeedExisting, [fixture.developmentSeed.positionDepartmentAssignmentId, fixture.developmentSeed.positionId, fixture.developmentSeed.departmentId], SQL.assignmentSeedInsert, [fixture.developmentSeed.positionDepartmentAssignmentId, fixture.tenant.id, fixture.property.id, fixture.developmentSeed.positionId, fixture.developmentSeed.departmentId], { id: fixture.developmentSeed.positionDepartmentAssignmentId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, position_id: fixture.developmentSeed.positionId, department_id: fixture.developmentSeed.departmentId, is_active: true }],
      ["employee", SQL.employeeExisting, [fixture.developmentSeed.employeeId, fixture.property.id], SQL.employeeInsert, [fixture.developmentSeed.employeeId, fixture.tenant.id, fixture.property.id, fixture.developmentSeed.departmentId, fixture.developmentSeed.positionId, fixture.developmentSeed.positionFamilyId], { id: fixture.developmentSeed.employeeId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, employee_number: "DEV-001", is_active: true }],
      ["employeeIdentifier", SQL.identifierExisting, [fixture.developmentSeed.employeeIdentifierId, fixture.property.id], SQL.identifierInsert, [fixture.developmentSeed.employeeIdentifierId, fixture.tenant.id, fixture.property.id, fixture.developmentSeed.employeeId], { id: fixture.developmentSeed.employeeIdentifierId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, employee_id: fixture.developmentSeed.employeeId, source_system: "neon-first-seed", identifier_value: "DEV-001", is_active: true }],
    ];
    for (const [name, selectSql, selectValues, insertSql, insertValues, expected] of specs.slice(0, 10)) if (await ensure(dbClient, { selectSql, selectValues, insertSql, insertValues, expected })) created.push(name);
    if (await ensureSteps(dbClient, fixture)) created.push("initializationSteps");
    for (const [name, selectSql, selectValues, insertSql, insertValues, expected] of specs.slice(10)) if (await ensure(dbClient, { selectSql, selectValues, insertSql, insertValues, expected })) created.push(name);
    const details = JSON.stringify({ source: "neon-first-initialization", seedVersion: fixture.seedVersion, created, runtimePath: false, credentialsRecorded: false, authUserId });
    await dbClient.query(SQL.organizationAudit, [requestId, authUserId, fixture.manager.profileId, fixture.tenant.id, fixture.property.id, fixture.developmentSeed.departmentId, details]);
    await dbClient.query(SQL.propertyAudit, [requestId, authUserId, fixture.tenant.id, fixture.property.id, fixture.property.id, details]);
    await dbClient.query(SQL.initializationAudit, [requestId, authUserId, fixture.tenant.id, fixture.property.id, details]);
    await dbClient.query(dryRun ? "rollback" : "commit");
    return { status: dryRun ? "dry_run" : created.length === 0 ? "already_present" : "created", created, requestId, authUserId, tenantId: fixture.tenant.id, propertyId: fixture.property.id, profileId: fixture.manager.profileId, roleAssignmentId: fixture.manager.roleAssignmentId, seedVersion: fixture.seedVersion, committedAt: now.toISOString() };
  } catch (error) {
    try { await dbClient.query("rollback"); } catch { /* preserve original failure */ }
    throw error;
  } finally {
    if (release) {
      dbClient.release();
      await pool.end();
    }
  }
}
