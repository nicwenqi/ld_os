import { randomUUID } from "node:crypto";
import pg from "pg";
import { NEON_FIRST_INITIALIZATION_STEP_KEYS, validateInitializationFixture, validateInitializationTarget } from "./neon-first-initialization-contract.mjs";
import { APPROVED_NEON_FIRST_INITIALIZATION_TARGETS } from "./neon-first-initialization-targets.mjs";

const { Pool } = pg;
const ALLOWED_URL_QUERY_KEYS = new Set(["sslmode", "channel_binding"]);
const CONFIRMED_STEPS = new Set(["identity", "organization", "positions", "access"]);
const DATABASE_CONTRACT_BY_SPEC = Object.freeze({
  tenant: "TENANTS",
  property: "PROPERTIES",
  propertyDomain: "PROPERTY_DOMAINS",
  profile: "PROFILES",
  userAccount: "USER_ACCOUNTS",
  tenantMembership: "TENANT_MEMBERSHIPS",
  propertyMembership: "PROPERTY_MEMBERSHIPS",
  role: "ROLES",
  roleAssignment: "ROLE_ASSIGNMENTS",
  propertySettings: "PROPERTY_SETTINGS",
  department: "DEPARTMENTS",
  positionFamily: "POSITION_FAMILIES",
  position: "POSITIONS",
  positionDepartmentAssignment: "POSITION_DEPARTMENT_ASSIGNMENTS",
  employee: "EMPLOYEES",
  employeeIdentifier: "EMPLOYEE_EXTERNAL_IDENTIFIERS",
});

const SQL = Object.freeze({
  tenantExisting: "select id, code, name, status from public.tenants where id = $1 or code = $2 order by id",
  tenantInsert: "insert into public.tenants (id, code, name, status) values ($1, $2, $3, 'active') on conflict do nothing",
  propertyExisting: "select id, tenant_id, code, name_zh, name_en, status from public.properties where id = $1 or (tenant_id = $2 and code = $3) order by id",
  propertyInsert: "insert into public.properties (id, tenant_id, code, name_zh, name_en, country_region, timezone, default_language, status) values ($1, $2, $3, $4, $5, $6, $7, $8, 'active') on conflict do nothing",
  domainExisting: "select id, tenant_id, property_id, hostname, verification_status, is_active from public.property_domains where id = $1 or hostname = $2 order by id",
  domainInsert: "insert into public.property_domains (id, tenant_id, property_id, hostname, verification_status, is_active) values ($1, $2, $3, $4, 'verified', true) on conflict do nothing",
  domainAcceptanceState: `select
    tenant.code as tenant_code,
    tenant.status as tenant_status,
    property.code as property_code,
    property.status as property_status,
    (not domain.is_active
      and tenant.status = 'inactive'
      and property.status = 'inactive'
      and tenant.code ~ '^acc-[0-9a-f]{8}$'
      and property.code ~ '^acc-[0-9a-f]{8}$'
      and tenant.code = property.code
      and exists(select 1 from app_private.property_write_audit_events audit where audit.tenant_id = domain.tenant_id and audit.property_id = domain.property_id and audit.operation = 'neon_first_initialization' and audit.target_id = domain.property_id and audit.details->>'source' = 'neon-first-initialization' and audit.details->>'runtimePath' = 'false')
      and exists(select 1 from app_private.organization_write_audit_events audit where audit.tenant_id = domain.tenant_id and audit.property_id = domain.property_id and audit.operation = 'neon_first_initialization' and audit.details->>'source' = 'neon-first-initialization' and audit.details->>'runtimePath' = 'false')
      and exists(select 1 from app_private.initialization_audit_events audit where audit.tenant_id = domain.tenant_id and audit.property_id = domain.property_id and audit.operation = 'neon_first_initialization' and audit.details->>'source' = 'neon-first-initialization' and audit.details->>'runtimePath' = 'false')
      and not exists(select 1 from public.properties sibling where sibling.tenant_id = domain.tenant_id and sibling.status in ('initializing', 'active'))
      and not exists(select 1 from public.property_domains sibling where sibling.tenant_id = domain.tenant_id and sibling.is_active)
      and not exists(select 1 from public.user_accounts account where account.tenant_id = domain.tenant_id and account.property_id = domain.property_id and account.account_status = 'active')
      and not exists(select 1 from public.user_accounts account join public.profiles profile on profile.id = account.user_id where account.tenant_id = domain.tenant_id and account.property_id = domain.property_id and profile.is_active)
      and not exists(select 1 from public.tenant_memberships membership where membership.tenant_id = domain.tenant_id and membership.status = 'active')
      and not exists(select 1 from public.property_memberships membership where membership.tenant_id = domain.tenant_id and membership.property_id = domain.property_id and membership.status = 'active')
      and not exists(select 1 from public.role_assignments assignment where assignment.tenant_id = domain.tenant_id and assignment.property_id = domain.property_id and assignment.status = 'active')
      and not exists(select 1 from public.roles role where role.tenant_id = domain.tenant_id and role.property_id = domain.property_id and role.is_active)
      and not exists(select 1 from public.departments department where department.tenant_id = domain.tenant_id and department.property_id = domain.property_id and department.is_active)
      and not exists(select 1 from public.operational_units unit where unit.tenant_id = domain.tenant_id and unit.property_id = domain.property_id and unit.is_active)
      and not exists(select 1 from public.position_families family where family.tenant_id = domain.tenant_id and family.property_id = domain.property_id and family.is_active)
      and not exists(select 1 from public.positions position where position.tenant_id = domain.tenant_id and position.property_id = domain.property_id and position.is_active)
      and not exists(select 1 from public.position_department_assignments assignment where assignment.tenant_id = domain.tenant_id and assignment.property_id = domain.property_id and assignment.is_active)
      and not exists(select 1 from public.employees employee where employee.tenant_id = domain.tenant_id and employee.property_id = domain.property_id and employee.is_active)
      and not exists(select 1 from public.employee_external_identifiers identifier where identifier.tenant_id = domain.tenant_id and identifier.property_id = domain.property_id and identifier.is_active)
    ) as terminal_acceptance
    from public.property_domains domain
    join public.tenants tenant on tenant.id = domain.tenant_id
    join public.properties property on property.tenant_id = domain.tenant_id and property.id = domain.property_id
    where domain.id = $1 and domain.hostname = $2 and domain.tenant_id = $3 and domain.property_id = $4`,
  domainImportRelations: "select to_regclass('public.import_commits') as import_commits",
  domainUnrevertedImportCommits: "select count(*)::integer as count from public.import_commits where tenant_id = $1 and property_id = $2 and status <> 'reverted'",
  domainRebind: "update public.property_domains set tenant_id = $1, property_id = $2, verification_status = 'verified', is_active = true where id = $3 and hostname = $4 and tenant_id = $5 and property_id = $6 and is_active = false returning id, tenant_id, property_id, hostname, verification_status, is_active",
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
  assignmentSeedInsert: "insert into public.position_department_assignments (id, tenant_id, property_id, position_id, department_id, is_active) values ($1, $2, $3, $4, $5, true) on conflict do nothing",
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

function propertyDomainConflict(contract) {
  fail(`NEON_FIRST_INIT_ROW_CONFLICT:PROPERTY_DOMAINS:${contract}`);
}

function isExpectedPropertyDomain(row, expected, preserveExistingId = false) {
  return row && Object.entries(expected).every(([key, value]) => (preserveExistingId && key === "id") || row[key] === value);
}

async function ensurePropertyDomain(client, fixture) {
  const expected = {
    id: fixture.propertyDomain.id,
    tenant_id: fixture.tenant.id,
    property_id: fixture.property.id,
    hostname: fixture.propertyDomain.hostname,
    verification_status: "verified",
    is_active: true,
  };
  const selectValues = [expected.id, expected.hostname];
  let existing = await client.query(SQL.domainExisting, selectValues);
  if (existing.rows.length > 1) propertyDomainConflict("ID_OR_HOSTNAME");
  let created = false;
  if (existing.rows.length === 0) {
    await client.query(SQL.domainInsert, [expected.id, expected.tenant_id, expected.property_id, expected.hostname]);
    created = true;
    existing = await client.query(SQL.domainExisting, selectValues);
    if (existing.rows.length !== 1) fail("NEON_FIRST_INIT_ROW_MISSING");
  }
  const current = existing.rows[0];
  if (isExpectedPropertyDomain(current, expected, true)) return created;
  if (current?.hostname !== expected.hostname) propertyDomainConflict("ID");
  if (current?.is_active !== false) propertyDomainConflict("HOSTNAME");
  if (!/^acc-[0-9a-f]{8}$/.test(fixture.tenant.code) || fixture.property.code !== fixture.tenant.code) propertyDomainConflict("HOSTNAME");
  const ownership = await client.query(SQL.domainAcceptanceState, [current.id, current.hostname, current.tenant_id, current.property_id]);
  const historical = ownership.rows?.[0];
  if (ownership.rows.length !== 1 || historical?.terminal_acceptance !== true || !/^acc-[0-9a-f]{8}$/.test(historical.tenant_code) || historical.property_code !== historical.tenant_code) propertyDomainConflict("HOSTNAME");
  const relations = await client.query(SQL.domainImportRelations);
  if (relations.rows?.[0]?.import_commits) {
    const importCommits = await client.query(SQL.domainUnrevertedImportCommits, [current.tenant_id, current.property_id]);
    if (Number(importCommits.rows?.[0]?.count ?? -1) !== 0) propertyDomainConflict("HOSTNAME");
  }
  const rebound = await client.query(SQL.domainRebind, [expected.tenant_id, expected.property_id, current.id, current.hostname, current.tenant_id, current.property_id]);
  if (rebound.rowCount !== 1 || rebound.rows?.[0]?.id !== current.id || !isExpectedPropertyDomain(rebound.rows[0], expected, true)) propertyDomainConflict("HOSTNAME");
  const after = await client.query(SQL.domainExisting, selectValues);
  if (after.rows.length !== 1 || after.rows[0]?.id !== current.id || !isExpectedPropertyDomain(after.rows[0], expected, true)) propertyDomainConflict("HOSTNAME");
  return true;
}

function annotateDatabaseContract(error, contractCode) {
  if (!error || typeof error !== "object" || !/^[0-9A-Z]{5}$/.test(String(error.code ?? "").toUpperCase())) return error;
  try {
    Object.defineProperty(error, "databaseContractCode", { configurable: true, value: contractCode });
  } catch { /* a frozen driver error is still safely mapped to the generic canonical contract */ }
  return error;
}

async function withDatabaseContract(contractCode, operation) {
  try { return await operation(); }
  catch (error) { throw annotateDatabaseContract(error, contractCode); }
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
    for (const [name, selectSql, selectValues, insertSql, insertValues, expected] of specs.slice(0, 10)) {
      const didCreate = name === "propertyDomain"
        ? await withDatabaseContract(DATABASE_CONTRACT_BY_SPEC[name], () => ensurePropertyDomain(dbClient, fixture))
        : await withDatabaseContract(DATABASE_CONTRACT_BY_SPEC[name], () => ensure(dbClient, { selectSql, selectValues, insertSql, insertValues, expected }));
      if (didCreate) created.push(name);
    }
    if (await withDatabaseContract("PROPERTY_INITIALIZATION_STEPS", () => ensureSteps(dbClient, fixture))) created.push("initializationSteps");
    for (const [name, selectSql, selectValues, insertSql, insertValues, expected] of specs.slice(10)) {
      if (await withDatabaseContract(DATABASE_CONTRACT_BY_SPEC[name], () => ensure(dbClient, { selectSql, selectValues, insertSql, insertValues, expected }))) created.push(name);
    }
    const details = JSON.stringify({ source: "neon-first-initialization", seedVersion: fixture.seedVersion, created, runtimePath: false, credentialsRecorded: false, authUserId });
    await withDatabaseContract("ORGANIZATION_WRITE_AUDIT_EVENTS", () => dbClient.query(SQL.organizationAudit, [requestId, authUserId, fixture.manager.profileId, fixture.tenant.id, fixture.property.id, fixture.developmentSeed.departmentId, details]));
    await withDatabaseContract("PROPERTY_WRITE_AUDIT_EVENTS", () => dbClient.query(SQL.propertyAudit, [requestId, authUserId, fixture.tenant.id, fixture.property.id, fixture.property.id, details]));
    await withDatabaseContract("INITIALIZATION_AUDIT_EVENTS", () => dbClient.query(SQL.initializationAudit, [requestId, authUserId, fixture.tenant.id, fixture.property.id, details]));
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
